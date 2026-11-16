import { CampusPreferenceStore } from "@/effect/services/CampusPreferenceStore";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { FirebaseAdminService } from "@/effect/services/FirebaseAdminService";
import { PushTokenRegistrationError } from "@/effect/services/push/errors";
import { createPushTokenLock } from "@/effect/services/push/lock";
import { PushTokenService } from "@/effect/services/PushTokenService";
import { effectiveCampusSlug } from "@/utils/campuses";
import { Context, Effect, Layer, Predicate } from "effect";

import type {
	RegisterPushTokenInput,
	UnregisterPushTokenInput,
} from "@/effect/services/push/firebase";

interface CampusRegistrationInput extends Omit<RegisterPushTokenInput, "campus"> {
	readonly followPreferredCampus?: boolean;
}

const make = Effect.gen(function* () {
	const scope = yield* Effect.scope;
	const store = yield* CampusPreferenceStore;
	const push = yield* PushTokenService;
	const firebase = yield* FirebaseAdminService;
	const { pool } = yield* DrizzleService;
	const lock = createPushTokenLock(pool);

	const applyRegistration = Effect.fn("CampusPushService.applyRegistration")(function* (
		input: CampusRegistrationInput,
	) {
		if (!input.followPreferredCampus) {
			return yield* push.registerToken(input);
		}
		if (input.channels?.some((channel) => channel?.startsWith("campus-"))) {
			return yield* new PushTokenRegistrationError({
				detail: "Campus channels come from the saved preference",
				retryable: false,
			});
		}
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const preference = input.userId ? yield* store.get(input.userId) : null;
			const registered = yield* push.registerToken({
				...input,
				campus: {
					slug: effectiveCampusSlug(preference?.preferredCampusSlug ?? null),
					version: preference?.campusPreferenceVersion ?? 0,
				},
			});
			if (!input.userId) {
				return registered;
			}
			const latest = yield* store.get(input.userId);
			if (latest.campusPreferenceVersion === registered.campusPreferenceVersion) {
				return registered;
			}
		}
		return yield* new PushTokenRegistrationError({
			detail: "Campus changed during registration; retry with the latest preference",
		});
	});

	const registerToken = (input: CampusRegistrationInput) =>
		lock.withLock(input.token, applyRegistration(input));
	const unregisterToken = (input: UnregisterPushTokenInput) =>
		lock.withLock(input.token, push.unregisterToken(input));
	const syncUser = Effect.fn("CampusPushService.syncUser")(function* (firebaseUid: string) {
		const preference = yield* store.get(firebaseUid);
		yield* firebase.mirrorUserCampusPreference(preference);
		const docs = yield* firebase.listPushTokenDocsByUserId(firebaseUid);
		yield* Effect.forEach(
			docs,
			(doc) =>
				Effect.gen(function* () {
					if (!Predicate.isString(doc.token) || doc.followPreferredCampus !== true) {
						return;
					}
					const { token } = doc;
					yield* lock.withLock(
						token,
						Effect.gen(function* () {
							const current = yield* firebase.readDocument(firebase.collections.pushTokens, token);
							if (current?.userId !== firebaseUid || current.followPreferredCampus !== true) {
								return;
							}
							const channels = Array.isArray(current.topics)
								? current.topics.filter(
										(topic): topic is string =>
											Predicate.isString(topic) &&
											!topic.startsWith("campus-") &&
											topic !== "announcement",
									)
								: [];
							yield* applyRegistration({
								token,
								userId: firebaseUid,
								logoutKey: Predicate.isString(current.logoutKey) ? current.logoutKey : null,
								followPreferredCampus: true,
								campusStreamNotifications: current.campusStreamNotifications === true,
								channels,
								platform: Predicate.isString(current.platform) ? current.platform : null,
							}).pipe(
								Effect.catchTag("PushTokenRegistrationError", (error) =>
									error.retryable === false ? Effect.void : Effect.fail(error),
								),
							);
						}),
					);
				}),
			{ discard: true },
		);
		yield* store.finish(firebaseUid, preference.campusPreferenceVersion, true);
	});
	// The durable row owns retries; the application scope owns this immediate attempt.
	const syncUserInBackground = (firebaseUid: string) =>
		syncUser(firebaseUid).pipe(
			Effect.catch((error) =>
				Effect.logWarning("Campus subscriptions remain pending", { errorTag: error._tag }),
			),
			Effect.forkIn(scope),
			Effect.asVoid,
		);
	const reconcilePending = Effect.fn("CampusPushService.reconcilePending")(function* () {
		const pending = yield* store.pending();
		const results = yield* Effect.forEach(
			pending,
			(entry) =>
				syncUser(entry.firebaseUid).pipe(
					Effect.as(true),
					Effect.catch((error) =>
						Effect.gen(function* () {
							yield* Effect.logWarning("Campus subscription synchronization will retry", {
								firebaseUid: entry.firebaseUid,
								version: entry.version,
								errorTag: error._tag,
							});
							yield* store.finish(entry.firebaseUid, entry.version, false);
							return false;
						}),
					),
				),
			{ concurrency: 2 },
		);
		return { processed: results.length, failed: results.filter((success) => !success).length };
	});
	return { registerToken, unregisterToken, syncUser, syncUserInBackground, reconcilePending };
});

export class CampusPushService extends Context.Service<
	CampusPushService,
	Effect.Success<typeof make>
>()("CampusPushService") {}
export const CampusPushServiceLive = Layer.effect(CampusPushService, make);
