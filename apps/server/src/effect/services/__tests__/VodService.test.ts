import { LRUService } from "@/effect/LRUService";
import { RedisService } from "@/effect/RedisService";
import { DrizzleService } from "@/effect/services/DrizzleService";
import {
	FirebaseAdminService,
	type FirestoreDocumentData,
} from "@/effect/services/FirebaseAdminService";
import { categoryCondition, NotificationCategoryTopic } from "@/effect/services/push/topics";
import {
	LRU_TTL_MS,
	REDIS_CACHE_KEY,
	REDIS_TTL_SECONDS,
	getTodayDateString,
} from "@/effect/services/vod/constants";
import { type CachedVodEntry } from "@/effect/services/vod/types";
import { VodService, VodServiceLive } from "@/effect/services/VodService";
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";

import type { Message } from "firebase-admin/messaging";

const VERSE_DOCUMENT = "dailyVerse/verseOfTheDay";

const publishedVerse = {
	book: "John 13:14",
	stBook: "JHN.13.14",
	text: "And since I, your Lord and Teacher, have washed your feet, you ought to wash each other's feet.",
	image: "https://images.example/john-13-14.jpg",
	verseId: "verse-published",
	date: "Fri Oct 02 2026",
};

const catalogVerse = {
	book: "Psalms 103:13",
	verseId: "verse-catalog",
	img: ["https://images.example/psalms-103-13.jpg"],
	stBook: ["PSA.103.13"],
	text: "Like as a father pitieth his children, so the Lord pitieth them that fear him.",
	nlt_translation:
		"The Lord is like a father to his children, tender and compassionate to those who fear him.",
};

/**
 * One host: Firestore, Redis and Postgres are shared by its replicas, while
 * each replica gets its own LRU. Postgres only answers what the rotation asks.
 */
function createHost() {
	const documents = new Map<string, FirestoreDocumentData>([[VERSE_DOCUMENT, publishedVerse]]);
	const redis = new Map<string, string>();
	const calls = {
		firestoreReads: 0,
		sqlSelects: 0,
		sqlWrites: 0,
		lruTtls: [] as (number | undefined)[],
		redisTtls: [] as number[],
		messages: [] as Message[],
	};

	const db = {
		select: () => {
			calls.sqlSelects += 1;
			return {
				from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: "scripture-1" }]) }) }),
			};
		},
		insert: () => {
			calls.sqlWrites += 1;
			return {
				values: () => ({
					onConflictDoNothing: () => Promise.resolve(),
					onConflictDoUpdate: () => Promise.resolve(),
				}),
			};
		},
	};
	const pool = {
		connect: () =>
			Promise.resolve({ query: () => Promise.resolve({ rows: [] }), release: () => null }),
	};

	const sharedLayer = Layer.mergeAll(
		Layer.succeed(RedisService, {
			get: (key: string) => Effect.succeed(redis.get(key) ?? null),
			setex: (key: string, ttlSeconds: number, value: string) =>
				Effect.sync(() => {
					calls.redisTtls.push(ttlSeconds);
					redis.set(key, value);
				}),
			del: (key: string) => Effect.sync(() => redis.delete(key)),
		} as never),
		Layer.succeed(FirebaseAdminService, {
			paths: { customVerse: "dailyVerse", verseOfTheDay: "verseOfTheDay" },
			collections: { wordActivationScriptures: "wordActivationScriptures" },
			readDocument: (collection: string, docId: string) =>
				Effect.sync(() => {
					calls.firestoreReads += 1;
					return documents.get(`${collection}/${docId}`);
				}),
			findFirstByDocumentId: () => Effect.succeed(catalogVerse),
			generateDocumentId: () => "random-key",
			writeDocument: (collection: string, docId: string, data: FirestoreDocumentData) =>
				Effect.sync(() => documents.set(`${collection}/${docId}`, data)),
			mergeDocument: (collection: string, docId: string, data: FirestoreDocumentData) =>
				Effect.sync(() => {
					const path = `${collection}/${docId}`;
					documents.set(path, { ...documents.get(path), ...data });
				}),
			deleteDocument: (collection: string, docId: string) =>
				Effect.sync(() => documents.delete(`${collection}/${docId}`)),
			sendMessage: (message: Message) =>
				Effect.sync(() => {
					calls.messages.push(message);
					return "message-id";
				}),
		} as never),
		Layer.succeed(DrizzleService, { db, pool } as never),
	);

	const replica = () => {
		const lru = new Map<string, CachedVodEntry>();
		const layer = VodServiceLive.pipe(
			Layer.provide(sharedLayer),
			Layer.provide(
				Layer.succeed(LRUService, {
					get: (key: string) => Effect.succeed(lru.get(key)),
					set: (key: string, value: CachedVodEntry, ttl?: number) =>
						Effect.sync(() => {
							calls.lruTtls.push(ttl);
							lru.set(key, value);
						}),
					delete: (key: string) => Effect.sync(() => lru.delete(key)),
				} as never),
			),
		);
		return <A, E>(program: Effect.Effect<A, E, VodService>) =>
			Effect.runPromise(Effect.provide(program, layer));
	};

	return { calls, documents, redis, replica };
}

const getDailyVerse = VodService.use((vod) => vod.getDailyVerse);
const setDailyVerse = VodService.use((vod) => vod.setDailyVerse);

describe("VodService.getDailyVerse", () => {
	it("reads the verse from Firestore on a cold cache and never queries Postgres", async () => {
		const { calls, replica } = createHost();

		const verse = await replica()(getDailyVerse);

		expect(verse).toEqual({
			book: "John 13:14",
			date: getTodayDateString(),
			stBook: "JHN.13.14",
			text: publishedVerse.text,
			nlt_translation: publishedVerse.text,
			verseId: "verse-published",
			image: "https://images.example/john-13-14.jpg",
		});
		expect(calls.firestoreReads).toBe(1);
		expect(calls.sqlSelects).toBe(0);
	});

	it("serves repeat reads from the LRU, and other replicas from Redis", async () => {
		const { calls, replica } = createHost();
		const first = replica();

		await first(getDailyVerse);
		await first(getDailyVerse);
		await replica()(getDailyVerse);

		expect(calls.firestoreReads).toBe(1);
	});

	it("ignores a cached verse from an earlier day", async () => {
		const { calls, redis, replica } = createHost();
		const yesterday = { ...publishedVerse, date: "2000-01-01" };
		redis.set(
			REDIS_CACHE_KEY,
			JSON.stringify({ data: yesterday, cachedAt: 1, date: "2000-01-01" }),
		);

		const verse = await replica()(getDailyVerse);

		expect(verse.date).toBe(getTodayDateString());
		expect(calls.firestoreReads).toBe(1);
	});

	it("caches briefly, so replicas and hosts the rotation skips catch up with Firestore", async () => {
		const { calls, replica } = createHost();

		await replica()(getDailyVerse);

		expect(calls.lruTtls).toEqual([LRU_TTL_MS]);
		expect(calls.redisTtls).toEqual([REDIS_TTL_SECONDS]);
		expect(LRU_TTL_MS).toBeLessThanOrEqual(30_000);
		expect(REDIS_TTL_SECONDS).toBeLessThanOrEqual(10 * 60);
	});

	it("fails with VodNotFoundError when the Firestore document is missing", async () => {
		const { documents, replica } = createHost();
		documents.delete(VERSE_DOCUMENT);

		const error = await replica()(Effect.flip(getDailyVerse));

		expect(error._tag).toBe("VodNotFoundError");
	});
});

describe("VodService.setDailyVerse", () => {
	it("replaces the cached verse in this replica's LRU and in Redis", async () => {
		const { calls, replica } = createHost();
		const rotating = replica();
		await rotating(getDailyVerse);

		await rotating(setDailyVerse);
		const readsAfterRotation = calls.firestoreReads;
		const onRotatingReplica = await rotating(getDailyVerse);
		const onOtherReplica = await replica()(getDailyVerse);

		expect(onRotatingReplica.book).toBe("Psalms 103:13");
		expect(onOtherReplica.book).toBe("Psalms 103:13");
		expect(calls.firestoreReads).toBe(readsAfterRotation);
	});

	it("still writes the rotated verse to Postgres", async () => {
		const { calls, replica } = createHost();

		await replica()(setDailyVerse);

		expect(calls.sqlWrites).toBeGreaterThan(0);
	});
});

describe("VodService.sendPushNotification", () => {
	it("announces the Firestore verse without querying Postgres", async () => {
		const { calls, replica } = createHost();

		await replica()(VodService.use((vod) => vod.sendPushNotification));

		expect(calls.messages).toHaveLength(1);
		expect(calls.messages[0]?.notification?.title).toBe("John 13:14");
		expect(calls.messages[0]).toMatchObject({
			condition: categoryCondition(NotificationCategoryTopic.verseOfTheDay),
		});
		expect(calls.sqlSelects).toBe(0);
	});
});
