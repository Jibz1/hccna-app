import { LRUService } from "@/effect/LRUService";
import { RedisService } from "@/effect/RedisService";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { FirebaseAdminService } from "@/effect/services/FirebaseAdminService";
import { categoryCondition, NotificationCategoryTopic } from "@/effect/services/push/topics";
import { createVodCache } from "@/effect/services/vod/cache";
import { VOD_TIMEZONE, getTodayDateString } from "@/effect/services/vod/constants";
import { createVodFirebaseRepository } from "@/effect/services/vod/firebase";
import { createVodPostgresRepository } from "@/effect/services/vod/postgres";
import { createVodRotationLock } from "@/effect/services/vod/rotationLock";
import { toVerseOfTheDay, toScriptureData } from "@/effect/services/vod/transforms";
import {
	VodPushNotificationError,
	VodSetError,
	type VodFetchError,
	type VodNotFoundError,
} from "@/graphql/schema/scriptures/vodErrors";
import { omitUndefined } from "@/utils/omitUndefined";
import { Context, Effect, Layer, Option } from "effect";

import type { ScriptureData } from "@/graphql/schema/scriptures/scripture";

interface VodServiceContract {
	getDailyVerse: Effect.Effect<ScriptureData, VodFetchError | VodNotFoundError>;
	setDailyVerse: Effect.Effect<void, VodSetError>;
	sendPushNotification: Effect.Effect<
		void,
		VodFetchError | VodNotFoundError | VodPushNotificationError
	>;
	getRandomWordActivationVerse: Effect.Effect<ScriptureData, VodSetError, never>;
}

/**
 * VodService - Orchestrates the verse of the day across Firebase (source of
 * truth, and the read source), Postgres (a dated copy written on rotation, not
 * read for now) and a two-tier cache. The Firebase/Postgres I/O and caching
 * live in `./vod/*`; this service only sequences them.
 */
export class VodService extends Context.Service<VodService, VodServiceContract>()("VodService", {
	make: Effect.gen(function* () {
		const { db, pool } = yield* DrizzleService;
		const firebaseAdmin = yield* FirebaseAdminService;
		const lru = yield* LRUService;
		const redis = yield* RedisService;

		const firebase = createVodFirebaseRepository({
			verseCollection: firebaseAdmin.paths.customVerse,
			verseDocId: firebaseAdmin.paths.verseOfTheDay,
			wordActivationCollection: firebaseAdmin.collections.wordActivationScriptures,
			readDocument: firebaseAdmin.readDocument,
			findFirstByDocumentId: firebaseAdmin.findFirstByDocumentId,
			generateDocumentId: firebaseAdmin.generateDocumentId,
			writeDocument: firebaseAdmin.writeDocument,
			mergeDocument: firebaseAdmin.mergeDocument,
			deleteDocument: firebaseAdmin.deleteDocument,
		});
		const postgres = createVodPostgresRepository({ db });
		const cache = createVodCache({ lru, redis });
		const rotationLock = createVodRotationLock(pool);

		// Postgres reads stay off until the Railway migration settles: a host's
		// Postgres copy is set by whichever read or rotation reached it first,
		// so a host the rotation skipped kept the previous day's verse.
		const fetchFromFirebase = Effect.fn("VodService.fetchFromFirebase")(function* (today: string) {
			return toScriptureData(yield* firebase.getDailyVerse, today);
		});

		// Read flow: LRU -> Redis -> Firebase.
		const getDailyVerse = Effect.gen(function* () {
			const today = getTodayDateString();

			const lruEntry = yield* cache.getFromLru(today);
			if (Option.isSome(lruEntry)) {
				yield* Effect.logDebug("LRU cache hit").pipe(
					Effect.annotateLogs({ operation: "getDailyVerse" }),
				);
				return lruEntry.value.data;
			}

			const redisEntry = yield* cache.getFromRedis(today);
			if (Option.isSome(redisEntry)) {
				yield* Effect.logDebug("Redis cache hit").pipe(
					Effect.annotateLogs({ operation: "getDailyVerse" }),
				);
				yield* cache.setToLru(redisEntry.value.data, today);
				return redisEntry.value.data;
			}

			yield* Effect.logDebug("Cache miss, fetching from Firebase").pipe(
				Effect.annotateLogs({ operation: "getDailyVerse" }),
			);
			const freshData = yield* fetchFromFirebase(today);
			yield* cache.setBothCaches(freshData, today);

			return freshData;
		}).pipe(Effect.withSpan("VodService.getDailyVerse"));

		const getRandomWordActivationVerse = Effect.gen(function* () {
			const wordActivationVerse = yield* firebase.getRandomWordActivationVerse;
			const dailyVerse = toVerseOfTheDay(wordActivationVerse);
			return toScriptureData(dailyVerse, getTodayDateString());
		}).pipe(Effect.withSpan("VodService.getRandomWordActivationVerse"));

		// Rotate the verse: publish to Firebase first, then mirror to Postgres,
		// rolling Firebase back if the SQL persistence fails.
		const rotateDailyVerse = Effect.gen(function* () {
			const today = getTodayDateString();

			yield* Effect.logInfo("Setting daily verse").pipe(
				Effect.annotateLogs({ operation: "setDailyVerse" }),
			);

			const wordActivationVerse = yield* firebase.getRandomWordActivationVerse;
			const firebaseVerse = toVerseOfTheDay(wordActivationVerse);

			yield* Effect.logInfo("Selected Firebase verse").pipe(
				Effect.annotateLogs({ operation: "setDailyVerse", verseId: firebaseVerse.verseId }),
			);

			const previousDailyVerse = yield* firebase.readExistingDailyVerse;
			yield* firebase.publishDailyVerse(wordActivationVerse);

			const persistResult = yield* Effect.result(
				Effect.gen(function* () {
					const scriptureId = yield* postgres
						.getOrCreateScriptureId(firebaseVerse)
						.pipe(Effect.mapError((e) => new VodSetError({ detail: e.message, cause: e.cause })));

					yield* postgres
						.persistDailyVerse(scriptureId, firebaseVerse.image, today)
						.pipe(Effect.mapError((e) => new VodSetError({ detail: e.message, cause: e.cause })));
				}),
			);

			if (persistResult._tag === "Failure") {
				yield* firebase.restoreDailyVerse(previousDailyVerse);
				return yield* persistResult.failure;
			}

			// Bust the old same-day value, then warm both origin cache tiers with
			// the verse that was just persisted. The GraphQL mutation separately
			// invalidates the response cache and Stellate edge cache on success.
			yield* cache.invalidate();
			yield* cache.setBothCaches(toScriptureData(firebaseVerse, today), today);

			yield* Effect.logInfo("Daily verse set").pipe(
				Effect.annotateLogs({
					operation: "setDailyVerse",
					date: today,
					timezone: VOD_TIMEZONE,
				}),
			);
		});
		const setDailyVerse = rotationLock
			.withLock(rotateDailyVerse)
			.pipe(Effect.withSpan("VodService.setDailyVerse"));

		const sendPushNotification = Effect.gen(function* () {
			const verse = yield* fetchFromFirebase(getTodayDateString());
			const data = { type: "vod" };

			yield* firebaseAdmin
				.sendMessage({
					condition: categoryCondition(NotificationCategoryTopic.verseOfTheDay),
					data,
					// Installed Expo iOS builds read content.data from APNs' body object.
					apns: { payload: { aps: {}, body: data } },
					notification: omitUndefined({
						title: verse.book,
						body: verse.text,
						imageUrl: verse.image || undefined,
					}),
				})
				.pipe(
					Effect.mapError(
						(error) =>
							new VodPushNotificationError({
								detail: "Failed to send push notification",
								cause: error.cause,
							}),
					),
				);
		}).pipe(Effect.withSpan("VodService.sendPushNotification"));

		return {
			getDailyVerse,
			setDailyVerse,
			sendPushNotification,
			getRandomWordActivationVerse,
		} satisfies VodServiceContract;
	}),
}) {}

export const VodServiceLive = Layer.effect(VodService, VodService.make);
