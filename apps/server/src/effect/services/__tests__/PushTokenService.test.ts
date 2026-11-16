import {
	FirebaseAdminService,
	FirebaseFirestoreWriteError,
	FirebaseMessagingError,
} from "@/effect/services/FirebaseAdminService";
import { PushTokenService, PushTokenServiceLive } from "@/effect/services/PushTokenService";
import { CAMPUS_SLUGS } from "@/utils/campuses";
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";

import type { DocumentData } from "firebase-admin/firestore";

function createHarness(existingDoc: DocumentData) {
	const merged: DocumentData[] = [];

	const firebaseAdminStub = {
		collections: { pushTokens: "pushTokens" },
		dbFieldValue: { serverTimestamp: () => "server-timestamp" },
		readDocument: (_collection: string, _docId: string) => Effect.succeed({ ...existingDoc }),
		mergeDocument: (_collection: string, _docId: string, data: DocumentData) => {
			merged.push(data);
			return Effect.void;
		},
		deleteDocument: () => Effect.void,
		listPushTokenDocsByUserId: () => Effect.succeed([]),
		subscribeTokensToTopic: () => Effect.void,
		unsubscribeTokensFromTopic: () => Effect.void,
		sendEachForMulticast: () => Effect.die("unexpected send"),
	};

	const testLayer = PushTokenServiceLive.pipe(
		Layer.provide(Layer.succeed(FirebaseAdminService, firebaseAdminStub as never)),
	);

	return { merged, testLayer };
}

describe("PushTokenService.registerToken", () => {
	it("clears stored ownership when re-registered without a userId", async () => {
		const harness = createHarness({
			token: "token-1",
			topics: ["announcement"],
			userId: "user-1",
		});

		await Effect.runPromise(
			PushTokenService.use((service) => service.registerToken({ token: "token-1" })).pipe(
				Effect.provide(harness.testLayer),
			),
		);

		expect(harness.merged.at(-1)).toMatchObject({ userId: null });
	});
});

function createSettingsHarness(existingDoc: DocumentData | null, userDocs: DocumentData[] = []) {
	const calls: string[] = [];
	const sentTokens: string[][] = [];
	const firebaseAdminStub = {
		collections: { pushTokens: "pushTokens" },
		dbFieldValue: { serverTimestamp: () => "server-timestamp" },
		readDocument: () => Effect.succeed(existingDoc),
		mergeDocument: () => Effect.void,
		deleteDocument: () => Effect.void,
		listPushTokenDocsByUserId: () => Effect.succeed(userDocs),
		subscribeTokensToTopic: (_tokens: string[], topic: string) =>
			Effect.sync(() => calls.push(`+${topic}`)),
		unsubscribeTokensFromTopic: (_tokens: string[], topic: string) =>
			Effect.sync(() => calls.push(`-${topic}`)),
		sendEachForMulticast: (message: { tokens: string[] }) =>
			Effect.sync(() => {
				sentTokens.push(message.tokens);
				return {
					successCount: message.tokens.length,
					failureCount: 0,
					responses: message.tokens.map(() => ({ success: true })),
				};
			}),
	};
	const layer = PushTokenServiceLive.pipe(
		Layer.provide(Layer.succeed(FirebaseAdminService, firebaseAdminStub as never)),
	);
	const run = <A, E>(program: Effect.Effect<A, E, PushTokenService>) =>
		Effect.runPromise(Effect.provide(program, layer));
	return { calls, sentTokens, run };
}

describe("PushTokenService notification settings", () => {
	const settings = ["livestreams", "notify-prefs-v1", "verse-of-the-day"];

	const register = (campusStreamNotifications: boolean) =>
		PushTokenService.use((service) =>
			service.registerToken({
				token: "token-1",
				channels: settings,
				campus: { slug: "new-breed", version: 1 },
				campusStreamNotifications,
			}),
		);

	it("joins the marker before category topics and leaves it after them", async () => {
		const joining = createSettingsHarness({ token: "token-1", topics: ["announcement"] });
		const registered = await joining.run(register(true));

		expect(registered.topics).toEqual(expect.arrayContaining(settings));
		const added = joining.calls.filter((call) => call.startsWith("+"));
		expect(added.indexOf("+notify-prefs-v1")).toBeLessThan(added.indexOf("+livestreams"));

		const leaving = createSettingsHarness({
			token: "token-1",
			topics: ["announcement", "campus-new-breed", ...settings],
		});
		await leaving.run(
			PushTokenService.use((service) =>
				service.registerToken({
					token: "token-1",
					campus: { slug: "new-breed", version: 1 },
					campusStreamNotifications: true,
				}),
			),
		);
		const removed = leaving.calls.filter(
			(call) => call.startsWith("-") && settings.includes(call.slice(1)),
		);
		expect(removed.at(-1)).toBe("-notify-prefs-v1");
	});

	it("ignores settings from devices outside campus stream delivery", async () => {
		const harness = createSettingsHarness(null);
		const registered = await harness.run(register(false));

		expect(registered.topics).toEqual(["announcement", "campus-new-breed"]);
	});

	it("skips devices that turned a category off", async () => {
		const harness = createSettingsHarness(null, [
			{ token: "older-app", topics: ["announcement"] },
			{ token: "kept-on", topics: ["announcement", "notify-prefs-v1", "word-of-activation"] },
			{ token: "turned-off", topics: ["announcement", "notify-prefs-v1"] },
		]);
		const report = await harness.run(
			PushTokenService.use((service) =>
				service.sendToUser({
					userId: "user-1",
					notification: { title: "Word", body: "Verse" },
					category: "word-of-activation",
				}),
			),
		);

		expect(harness.sentTokens).toEqual([["older-app", "kept-on"]]);
		expect(report.successCount).toBe(2);
	});
});

// FCM calls that take a few milliseconds, logging when each starts and ends,
// and registry writes, logged as the write-ahead marker or the result.
function createTimedHarness(
	options: {
		readonly failCall?: string;
		readonly failMarker?: boolean;
		readonly channels?: readonly string[];
		readonly existingTopics?: readonly string[];
	} = {},
) {
	const events: string[] = [];
	let inFlight = 0;
	let maxInFlight = 0;
	const call = (name: string, delayMs: number) =>
		Effect.gen(function* () {
			events.push(`start ${name}`);
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			yield* Effect.sleep(delayMs);
			inFlight -= 1;
			events.push(`end ${name}`);
			if (name === options.failCall) {
				return yield* new FirebaseMessagingError({ detail: "FCM unavailable" });
			}
		});
	const firebaseAdminStub = {
		collections: { pushTokens: "pushTokens" },
		dbFieldValue: { serverTimestamp: () => "server-timestamp" },
		readDocument: () =>
			Effect.succeed({ token: "token-1", topics: options.existingTopics ?? ["announcement"] }),
		mergeDocument: (_collection: string, _docId: string, data: DocumentData) =>
			data["dirty"] === true && options.failMarker
				? Effect.fail(new FirebaseFirestoreWriteError({ detail: "write failed" }))
				: Effect.sync(() => {
						events.push(data["dirty"] === true ? "write marker" : "write result");
					}),
		deleteDocument: () => Effect.void,
		listPushTokenDocsByUserId: () => Effect.succeed([]),
		subscribeTokensToTopic: (_tokens: string[], topic: string) => call(`+${topic}`, 5),
		unsubscribeTokensFromTopic: (_tokens: string[], topic: string) =>
			call(`-${topic}`, topic === "campus-light-house" ? 30 : 5),
		sendEachForMulticast: () => Effect.die("unexpected send"),
	};
	const layer = PushTokenServiceLive.pipe(
		Layer.provide(Layer.succeed(FirebaseAdminService, firebaseAdminStub as never)),
	);
	const register = () =>
		Effect.runPromiseExit(
			PushTokenService.use((service) =>
				service.registerToken({
					token: "token-1",
					channels: options.channels ?? null,
					campus: { slug: "new-breed", version: 1 },
					campusStreamNotifications: true,
				}),
			).pipe(Effect.provide(layer)),
		);
	return { events, register, maxInFlight: () => maxInFlight };
}

const PREFERENCE_REMOVALS = [
	"-verse-of-the-day",
	"-livestreams",
	"-word-of-activation",
	...CAMPUS_SLUGS.map((slug) => `-follow-${slug}`),
];

const startedCalls = (events: readonly string[]) =>
	events.flatMap((event) => (event.startsWith("start ") ? [event.slice("start ".length)] : []));

// Where an event happened, failing the test when it never did.
const indexOfEvent = (events: readonly string[], event: string) => {
	expect(events).toContain(event);
	return events.indexOf(event);
};

describe("PushTokenService.registerToken concurrency", () => {
	it("applies every change the marker leaves unordered in one round", async () => {
		const harness = createTimedHarness();
		const exit = await harness.register();

		expect(exit._tag).toBe("Success");
		// The first round is every call that starts before any call finishes.
		const firstEnd = harness.events.findIndex((event) => event.startsWith("end "));
		const firstRound = startedCalls(harness.events.slice(0, firstEnd));
		expect(firstRound.toSorted()).toEqual(
			[
				...CAMPUS_SLUGS.filter((slug) => slug !== "new-breed").map((slug) => `-campus-${slug}`),
				"+announcement",
				"+campus-new-breed",
				...PREFERENCE_REMOVALS,
			].toSorted(),
		);
		// Only the marker and the audience wait, and only until the first round finished.
		const secondRound = ["+campus-stream-v2", "-notify-prefs-v1"];
		const firstRoundDone = Math.max(
			...firstRound.map((call) => harness.events.indexOf(`end ${call}`)),
		);
		expect(startedCalls(harness.events.slice(firstEnd)).toSorted()).toEqual(secondRound);
		expect(startedCalls(harness.events.slice(firstRoundDone)).toSorted()).toEqual(secondRound);
	});

	it("keeps category and follow topics inside the marker's membership", async () => {
		const joining = createTimedHarness({
			channels: ["notify-prefs-v1", "livestreams", "follow-light-house"],
		});
		const joiningExit = await joining.register();
		expect(joiningExit._tag).toBe("Success");
		const markerJoined = indexOfEvent(joining.events, "end +notify-prefs-v1");
		expect(markerJoined).toBeLessThan(indexOfEvent(joining.events, "start +livestreams"));
		expect(markerJoined).toBeLessThan(indexOfEvent(joining.events, "start +follow-light-house"));

		const leaving = createTimedHarness({
			existingTopics: [
				"announcement",
				"campus-new-breed",
				"notify-prefs-v1",
				"livestreams",
				"follow-light-house",
			],
		});
		const leavingExit = await leaving.register();
		expect(leavingExit._tag).toBe("Success");
		const markerLeaves = indexOfEvent(leaving.events, "start -notify-prefs-v1");
		for (const removal of PREFERENCE_REMOVALS) {
			expect([removal, indexOfEvent(leaving.events, `end ${removal}`) < markerLeaves]).toEqual([
				removal,
				true,
			]);
		}
	});

	it("applies the stream audience after its destination topics", async () => {
		const harness = createTimedHarness();
		const exit = await harness.register();
		expect(exit._tag).toBe("Success");

		const audience = harness.events.indexOf("start +campus-stream-v2");
		expect(harness.events.indexOf("end +announcement")).toBeLessThan(audience);
		expect(harness.events.indexOf("end +campus-new-breed")).toBeLessThan(audience);
		expect(harness.events.findLastIndex((event) => event.startsWith("end -campus-"))).toBeLessThan(
			audience,
		);
	});

	it("removes a previously saved campus topic once", async () => {
		const harness = createTimedHarness({
			existingTopics: ["announcement", "campus-light-house"],
		});
		const exit = await harness.register();
		expect(exit._tag).toBe("Success");

		expect(startedCalls(harness.events).filter((call) => call === "-campus-light-house")).toEqual([
			"-campus-light-house",
		]);
	});

	it("waits for calls already sent to FCM before reporting a failed round", async () => {
		const harness = createTimedHarness({ failCall: "-campus-house-of-stars" });
		const exit = await harness.register();

		expect(exit._tag).toBe("Failure");
		// The slower call in the same round still finished, and nothing after it started.
		expect(harness.events).toContain("end -campus-light-house");
		expect(harness.events).not.toContain("start -notify-prefs-v1");
		expect(harness.events).not.toContain("start +campus-stream-v2");
		expect(harness.events).not.toContain("write result");
	});

	it("adds no category or follow topic when the marker fails to join", async () => {
		const harness = createTimedHarness({
			failCall: "+notify-prefs-v1",
			channels: ["notify-prefs-v1", "livestreams", "follow-light-house"],
		});
		const exit = await harness.register();

		expect(exit._tag).toBe("Failure");
		expect(harness.events).not.toContain("start +livestreams");
		expect(harness.events).not.toContain("start +follow-light-house");
		expect(harness.events).not.toContain("write result");
	});

	it("marks the registration before its first FCM call and records it after the last", async () => {
		const harness = createTimedHarness();
		const exit = await harness.register();

		expect(exit._tag).toBe("Success");
		expect(harness.events[0]).toBe("write marker");
		expect(harness.events.at(-1)).toBe("write result");
		expect(harness.events.filter((event) => event.startsWith("write "))).toHaveLength(2);
	});

	it("makes no FCM call when the write-ahead marker cannot be saved", async () => {
		const harness = createTimedHarness({ failMarker: true });
		const exit = await harness.register();

		expect(exit._tag).toBe("Failure");
		expect(harness.events).toEqual([]);
	});

	it("limits how many FCM calls one registration makes at once", async () => {
		const channels = Array.from({ length: 200 }, (_, i) => `channel-${i}`);
		const harness = createTimedHarness({ channels });
		const exit = await harness.register();

		expect(exit._tag).toBe("Success");
		// Every campus topic, every preference topic and announcement.
		expect(harness.maxInFlight()).toBe(17);
	});
});

describe("PushTokenService logout", () => {
	function harness() {
		const docs = new Map<string, DocumentData>();
		const unsubscribed: string[] = [];
		let failFcm = false;
		const layer = PushTokenServiceLive.pipe(
			Layer.provide(
				Layer.succeed(FirebaseAdminService, {
					collections: { pushTokens: "tokens" },
					dbFieldValue: { serverTimestamp: () => "now" },
					readDocument: (collection: string, id: string) =>
						Effect.sync(() => docs.get(`${collection}/${id}`)),
					mergeDocument: (collection: string, id: string, data: DocumentData) =>
						Effect.sync(() => {
							docs.set(`${collection}/${id}`, { ...docs.get(`${collection}/${id}`), ...data });
						}),
					deleteDocument: (collection: string, id: string) =>
						Effect.sync(() => {
							docs.delete(`${collection}/${id}`);
						}),
					listPushTokenDocsByUserId: () => Effect.succeed([]),
					subscribeTokensToTopic: () => Effect.void,
					unsubscribeTokensFromTopic: (_tokens: string[], topic: string) =>
						Effect.suspend(() =>
							failFcm
								? Effect.fail(
										new FirebaseMessagingError({
											detail: "unsubscribe",
											cause: new Error("offline"),
										}),
									)
								: Effect.sync(() => {
										unsubscribed.push(topic);
									}),
						),
					sendEachForMulticast: () => Effect.die("unexpected send"),
				} as never),
			),
		);
		const run = <A, E>(effect: Effect.Effect<A, E, PushTokenService>) =>
			Effect.runPromise(effect.pipe(Effect.provide(layer)));
		return {
			docs,
			run,
			unsubscribed,
			setFailFcm: (value: boolean) => {
				failFcm = value;
			},
		};
	}
	const old = { token: "device", logoutKey: "old-key" };
	const register = (logoutKey?: string | null, userId = "user") =>
		PushTokenService.use((s) =>
			s.registerToken({ token: "device", logoutKey, userId, channels: ["campus-new-breed"] }),
		);
	const unregister = () => PushTokenService.use((s) => s.unregisterToken(old));

	it("detaches ownership and topics, and accepts repeated cleanup", async () => {
		const h = harness();
		await h.run(register(old.logoutKey));
		await h.run(unregister());
		await h.run(unregister());
		expect(h.docs.get("tokens/device")).toMatchObject({
			userId: null,
			logoutKey: null,
			topics: ["announcement"],
		});
		expect(h.unsubscribed).toContain("campus-new-breed");
	});
	it("does not remove a later registration, even for the same account", async () => {
		const h = harness();
		await h.run(register(old.logoutKey));
		await h.run(register("new-key"));
		await h.run(unregister());
		expect(h.docs.get("tokens/device")).toMatchObject({ userId: "user", logoutKey: "new-key" });
	});
	it("expires each retirement marker a week after the latest cleanup", async () => {
		const h = harness();
		const week = 7 * 24 * 60 * 60 * 1000;
		const before = Date.now();
		await h.run(unregister());
		const markers = [...h.docs].filter(([path]) => path.startsWith("tokens-retired/"));
		expect(markers).toHaveLength(1);
		const expireAt: Date = markers[0]?.[1].expireAt;
		expect(expireAt.getTime()).toBeGreaterThanOrEqual(before + week);
		expect(expireAt.getTime()).toBeLessThanOrEqual(Date.now() + week);
	});
	it("rejects registration arriving after its logout", async () => {
		const h = harness();
		await h.run(unregister());
		const error = await h.run(register(old.logoutKey).pipe(Effect.flip));
		expect(error.retryable).toBe(false);
		expect(h.docs.has("tokens/device")).toBe(false);
	});
	it("clears account ownership before FCM failure and retries the topics", async () => {
		const h = harness();
		await h.run(register(old.logoutKey));
		h.setFailFcm(true);
		await h.run(unregister().pipe(Effect.flip));
		expect(h.docs.get("tokens/device")).toMatchObject({ userId: null, logoutKey: old.logoutKey });
		h.setFailFcm(false);
		await h.run(unregister());
		expect(h.docs.get("tokens/device")?.logoutKey).toBeNull();
	});
	it("cleans a legacy registration after upgrade using the previous owner", async () => {
		const h = harness();
		await h.run(register());
		h.setFailFcm(true);
		await h.run(
			PushTokenService.use((service) =>
				service.unregisterToken({ ...old, legacyUserId: "user" }),
			).pipe(Effect.flip),
		);
		h.setFailFcm(false);
		await h.run(
			PushTokenService.use((service) => service.unregisterToken({ ...old, legacyUserId: "user" })),
		);
		expect(h.docs.get("tokens/device")).toMatchObject({ userId: null, topics: ["announcement"] });
	});
	it("does not detach another legacy owner or bypass a new cleanup key", async () => {
		const h = harness();
		await h.run(register(undefined, "other-user"));
		await h.run(
			PushTokenService.use((service) => service.unregisterToken({ ...old, legacyUserId: "user" })),
		);
		expect(h.docs.get("tokens/device")?.userId).toBe("other-user");
		await h.run(register("new-key", "user"));
		await h.run(
			PushTokenService.use((service) => service.unregisterToken({ ...old, legacyUserId: "user" })),
		);
		expect(h.docs.get("tokens/device")?.logoutKey).toBe("new-key");
	});
	it.each([undefined, null, ""])(
		"preserves legacy registration without a key (%s)",
		async (key) => {
			const h = harness();
			await h.run(register(key));
			await h.run(unregister());
			expect(h.docs.get("tokens/device")).toMatchObject({ userId: "user", logoutKey: null });
		},
	);
	it.each([" ", "k".repeat(257)])("rejects a key that cleanup could not accept", async (key) => {
		const h = harness();
		const error = await h.run(register(key).pipe(Effect.flip));
		expect(error.retryable).toBe(false);
		expect(h.docs.has("tokens/device")).toBe(false);
	});
});
