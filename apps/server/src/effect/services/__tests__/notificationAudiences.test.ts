import {
	FirebaseAdminService,
	FirebaseFirestoreWriteError,
	FirebaseMessagingError,
} from "@/effect/services/FirebaseAdminService";
import { streamNotificationTargets } from "@/effect/services/push/streamAudience";
import {
	allowsCategory,
	categoryCondition,
	NotificationCategoryTopic,
	normalizeTopics,
} from "@/effect/services/push/topics";
import { PushTokenService, PushTokenServiceLive } from "@/effect/services/PushTokenService";
import { CAMPUS_SLUGS, type CampusSlug } from "@/utils/campuses";
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";

import type { RegisterPushTokenInput } from "@/effect/services/push/firebase";
import type { DocumentData } from "firebase-admin/firestore";

// Evaluates the FCM condition grammar ('topic' in topics, &&, ||, !, parentheses).
function matches(condition: string, topics: readonly string[]): boolean {
	const tokens = condition.match(/'[^']+' in topics|&&|\|\||!|\(|\)/gu) ?? [];
	let index = 0;
	const or = (): boolean => {
		let value = and();
		while (tokens[index] === "||") {
			index += 1;
			value = and() || value;
		}
		return value;
	};
	const and = (): boolean => {
		let value = unary();
		while (tokens[index] === "&&") {
			index += 1;
			value = unary() && value;
		}
		return value;
	};
	const unary = (): boolean => {
		const token = tokens[index++];
		if (token === "!") {
			return !unary();
		}
		if (token === "(") {
			const value = or();
			index += 1;
			return value;
		}
		return topics.includes(token?.slice(1, token.indexOf("'", 1)) ?? "");
	};
	return or();
}

type ConditionNode =
	| { readonly kind: "topic" }
	| { readonly kind: "not"; readonly child: ConditionNode }
	| { readonly kind: "and" | "or"; readonly children: readonly ConditionNode[] };

/**
 * Parses an FCM topic condition, or returns undefined for one FCM rejects as
 * malformed: unbalanced parentheses, a stray or unrecognized token, or a `!` not
 * followed by `(`.
 */
function parseCondition(condition: string): ConditionNode | undefined {
	const tokens = condition.match(/'[^']+' in topics|&&|\|\||!|\(|\)/gu) ?? [];
	let index = 0;
	let malformed = false;
	const group = (kind: "and" | "or", operand: () => ConditionNode, operator: string) => {
		const children = [operand()];
		while (tokens[index] === operator) {
			index += 1;
			children.push(operand());
		}
		// Parentheses around the same operator do not nest a new group.
		const flat = children.flatMap((child) => (child.kind === kind ? child.children : [child]));
		return flat.length === 1 && flat[0] ? flat[0] : { kind, children: flat };
	};
	const or = (): ConditionNode => group("or", and, "||");
	const and = (): ConditionNode => group("and", unary, "&&");
	const parenthesized = (): ConditionNode => {
		const node = or();
		malformed ||= tokens[index] !== ")";
		index += 1;
		return node;
	};
	const unary = (): ConditionNode => {
		const token = tokens[index++];
		if (token === "!") {
			malformed ||= tokens[index++] !== "(";
			return { kind: "not", child: parenthesized() };
		}
		if (token === "(") {
			return parenthesized();
		}
		malformed ||= token?.endsWith(" in topics") !== true;
		return { kind: "topic" };
	};
	const root = or();
	// Text the token pattern skipped is something FCM would not parse either.
	const covered = tokens.join("").replaceAll(/\s/gu, "") === condition.replaceAll(/\s/gu, "");
	return malformed || !covered || index !== tokens.length ? undefined : root;
}

const topicCount = (node: ConditionNode): number => {
	switch (node.kind) {
		case "topic": {
			return 1;
		}
		case "not": {
			return topicCount(node.child);
		}
		default: {
			return node.children.reduce((sum, child) => sum + topicCount(child), 0);
		}
	}
};

const hasNegation = (node: ConditionNode): boolean =>
	node.kind === "not" || (node.kind !== "topic" && node.children.some(hasNegation));

// An `&&` group may negate operands only beside a positive one, and only when
// nothing below its other operands negates again.
const acceptsNegation = (node: ConditionNode): boolean => {
	if (!hasNegation(node)) {
		return true;
	}
	if (node.kind !== "and") {
		return false;
	}
	const negated = node.children.filter((child) => child.kind === "not");
	const positive = node.children.filter((child) => child.kind !== "not");
	return (
		positive.length > 0 &&
		positive.every((child) => !hasNegation(child)) &&
		negated.every((child) => child.kind === "not" && !hasNegation(child.child))
	);
};

/**
 * Whether FCM accepts a topic condition, as observed with `validate_only`
 * sends: at most five topics as written, and each negation parenthesized inside
 * an `&&` at the top level or directly under the top-level `||`. Mixed `&&` and
 * `||` without parentheses are not modeled: FCM reads them left to right.
 */
function fcmAccepts(condition: string): boolean {
	const root = parseCondition(condition);
	return (
		root !== undefined &&
		topicCount(root) <= 5 &&
		(root.kind === "or" ? root.children.every(acceptsNegation) : acceptsNegation(root))
	);
}

const deliveries = (campus: CampusSlug, enabled: boolean, topics: readonly string[]) =>
	streamNotificationTargets(campus, enabled).filter((target) => matches(target.condition, topics))
		.length;

// Indexes of the gate-on sends that reach a device.
const sendsFor = (campus: CampusSlug, topics: readonly string[]) =>
	streamNotificationTargets(campus, true).flatMap((target, index) =>
		matches(target.condition, topics) ? [index] : [],
	);

const legacyApp = ["announcement"];
const campusApp = (campus: CampusSlug) => ["announcement", `campus-${campus}`, "campus-stream-v2"];
const settingsApp = (campus: CampusSlug, ...channels: string[]) => [
	...campusApp(campus),
	"notify-prefs-v1",
	...channels,
];

describe("normalizeTopics", () => {
	it("keeps preference topics only for campus stream devices that send the marker", () => {
		const channels = ["notify-prefs-v1", "livestreams", "follow-new-breed"];

		expect(normalizeTopics(channels, { allowPreferences: true })).toEqual([
			"announcement",
			...channels,
		]);
		expect(normalizeTopics(channels)).toEqual(["announcement"]);
		expect(normalizeTopics(["livestreams"], { allowPreferences: true })).toEqual(["announcement"]);
	});

	it("drops follow topics for campuses that do not exist", () => {
		expect(
			normalizeTopics(["notify-prefs-v1", "follow-nowhere"], { allowPreferences: true }),
		).toEqual(["announcement", "notify-prefs-v1"]);
	});
});

describe("category delivery", () => {
	const condition = categoryCondition(NotificationCategoryTopic.verseOfTheDay);

	it("reaches older devices and devices that kept the category on", () => {
		expect(matches(condition, legacyApp)).toBe(true);
		expect(matches(condition, campusApp("house-of-stars"))).toBe(true);
		expect(matches(condition, settingsApp("new-breed", "verse-of-the-day"))).toBe(true);
		expect(matches(condition, settingsApp("new-breed"))).toBe(false);
	});

	it("filters per-device sends the same way", () => {
		expect(allowsCategory(legacyApp, "word-of-activation")).toBe(true);
		expect(
			allowsCategory(settingsApp("new-breed", "word-of-activation"), "word-of-activation"),
		).toBe(true);
		expect(allowsCategory(settingsApp("new-breed"), "word-of-activation")).toBe(false);
	});
});

describe("fcmAccepts", () => {
	// Outcomes of FCM v1 `validate_only` sends made on 2026-11-06.
	const observed: [string, boolean][] = [
		["a || b || c || d || e", true],
		["a || b || c || d || e || f", false],
		["a && b && c && d && e && f", false],
		["(a && b && c) || (d && e && f)", false],
		["(a || b) && (c || d || e)", true],
		["a && (b || c || d || e)", true],
		["!(a) && b && c && d && e", true],
		["a && !(b) && !(c) && !(d) && !(e)", true],
		["!(a && b) && (c || d)", true],
		["!(a) && ((b && c) || (d && e))", true],
		["a || (b && !(c))", true],
		["a || (b && !c)", false],
		["(a && b && c) || (d && !(e))", true],
		["(b && c) || (d && !(c))", true],
		["!(a) && ((b && c) || (d && !(c)))", false],
		["a && ((b && c) || (d && !(e)))", false],
		["a && (b || (c && !(d)))", false],
		["!(a) || b || c || d || e", false],
		["!(a) && !(b)", false],
		["!(a)", false],
	];

	// Each shorthand letter stands for the topic the probe used, so the expanded
	// string is the exact condition FCM was sent.
	it.each(observed)("%s → %p", (shorthand, accepted) => {
		const condition = shorthand.replaceAll(/\b(?<topic>[a-f])\b/gu, "'zz-$<topic>' in topics");

		expect(fcmAccepts(condition)).toBe(accepted);
	});
});

describe("parseCondition", () => {
	it("rejects malformed conditions", () => {
		for (const condition of [
			"'a' in topics && 'b' in topics junk",
			"('a' in topics",
			"'a' in topics)",
			"'a' in topics &&",
		]) {
			expect([condition, parseCondition(condition)]).toEqual([condition, undefined]);
		}
	});
});

describe("streamNotificationTargets", () => {
	it("only builds conditions FCM accepts", () => {
		for (const campus of CAMPUS_SLUGS) {
			for (const enabled of [true, false]) {
				for (const { condition } of streamNotificationTargets(campus, enabled)) {
					expect([campus, enabled, condition, fcmAccepts(condition)]).toEqual([
						campus,
						enabled,
						condition,
						true,
					]);
				}
			}
		}
	});

	it("only builds category conditions FCM accepts", () => {
		for (const category of Object.values(NotificationCategoryTopic)) {
			expect(fcmAccepts(categoryCondition(category))).toBe(true);
		}
	});

	// Sends go out one after another, so a device that joins or leaves campus mode
	// between them would get a second copy if each mode matched a different send.
	it("never reaches a device through different sends in and out of campus mode", () => {
		for (const streamCampus of CAMPUS_SLUGS) {
			for (const deviceCampus of [undefined, ...CAMPUS_SLUGS]) {
				const outside = deviceCampus ? [...legacyApp, `campus-${deviceCampus}`] : legacyApp;
				const reached = new Set([
					...sendsFor(streamCampus, outside),
					...sendsFor(streamCampus, [...outside, "campus-stream-v2"]),
				]);
				expect([streamCampus, deviceCampus, reached.size <= 1]).toEqual([
					streamCampus,
					deviceCampus,
					true,
				]);
			}
		}
		// The device of the 2026-11-06 failure: House of Stars, with or without campus mode.
		expect(sendsFor("house-of-stars", campusApp("house-of-stars"))).toEqual(
			sendsFor("house-of-stars", legacyApp),
		);
	});

	it("delivers each campus stream at most once to every kind of device", () => {
		const cases: [string, readonly string[], number][] = [
			["older app", legacyApp, 1],
			["campus app at House of Stars", campusApp("house-of-stars"), 1],
			["campus app elsewhere", campusApp("new-breed"), 0],
			["livestreams on at House of Stars", settingsApp("house-of-stars", "livestreams"), 1],
			["livestreams off at House of Stars", settingsApp("house-of-stars"), 0],
			["livestreams on elsewhere", settingsApp("new-breed", "livestreams"), 0],
			["following House of Stars", settingsApp("new-breed", "follow-house-of-stars"), 1],
			[
				"own campus and following it",
				settingsApp("house-of-stars", "livestreams", "follow-house-of-stars"),
				1,
			],
		];
		for (const [name, topics, expected] of cases) {
			expect([name, deliveries("house-of-stars", true, topics)]).toEqual([name, expected]);
		}
	});

	it("targets other campuses only through their members and followers", () => {
		expect(deliveries("new-breed", true, legacyApp)).toBe(0);
		expect(deliveries("new-breed", true, campusApp("new-breed"))).toBe(1);
		expect(deliveries("new-breed", true, settingsApp("new-breed", "livestreams"))).toBe(1);
		expect(deliveries("new-breed", true, settingsApp("new-breed"))).toBe(0);
		expect(deliveries("new-breed", true, settingsApp("light-house", "follow-new-breed"))).toBe(1);
	});

	it("keeps the marked and unmarked sends apart before the audience marker joins", () => {
		const joining = ["announcement", "notify-prefs-v1", "livestreams", "campus-house-of-stars"];

		expect(deliveries("house-of-stars", true, joining)).toBe(1);
	});

	it("keeps House of Stars streams for everyone who wants them while campus delivery is off", () => {
		expect(deliveries("house-of-stars", false, legacyApp)).toBe(1);
		expect(deliveries("house-of-stars", false, campusApp("new-breed"))).toBe(1);
		expect(deliveries("house-of-stars", false, settingsApp("new-breed", "livestreams"))).toBe(1);
		expect(deliveries("house-of-stars", false, settingsApp("new-breed"))).toBe(0);
		expect(streamNotificationTargets("new-breed", false)).toEqual([]);
	});
});

interface RegistrationFailures {
	// Fails only the write that records the registration's topics.
	readonly failMerge?: boolean;
	readonly failCall?: string;
}

// In-memory FCM membership and registry document for one token, recording the
// calls and the topics after every call.
function createMembershipHarness() {
	let membership = new Set<string>();
	let doc: DocumentData | null = null;
	let failures: RegistrationFailures = {};
	let calls: string[] = [];
	let writes: DocumentData[] = [];
	let trace: string[][] = [];
	let inFlight = 0;
	let maxInFlight = 0;
	const record = (call: string, next: Set<string>) =>
		call === failures.failCall
			? Effect.fail(new FirebaseMessagingError({ detail: "FCM unavailable" }))
			: Effect.sync(() => {
					calls.push(call);
					membership = next;
					trace.push([...next]);
				});
	const firebaseAdminStub = {
		collections: { pushTokens: "pushTokens" },
		dbFieldValue: { serverTimestamp: () => "server-timestamp" },
		readDocument: () => Effect.sync(() => (doc ? { ...doc } : undefined)),
		mergeDocument: (_collection: string, _docId: string, data: DocumentData) =>
			failures.failMerge === true && "topics" in data
				? Effect.fail(new FirebaseFirestoreWriteError({ detail: "write failed" }))
				: Effect.sync(() => {
						writes.push(data);
						doc = { ...doc, ...data };
					}),
		deleteDocument: () => Effect.void,
		subscribeTokensToTopic: (_tokens: string[], topic: string) =>
			record(`+${topic}`, new Set([...membership, topic])),
		unsubscribeTokensFromTopic: (_tokens: string[], topic: string) =>
			Effect.gen(function* () {
				inFlight += 1;
				maxInFlight = Math.max(maxInFlight, inFlight);
				yield* Effect.yieldNow;
				inFlight -= 1;
				yield* record(`-${topic}`, new Set([...membership].filter((member) => member !== topic)));
			}),
	};
	const layer = PushTokenServiceLive.pipe(
		Layer.provide(Layer.succeed(FirebaseAdminService, firebaseAdminStub as never)),
	);
	return {
		// A document written before registrations marked their FCM calls has no
		// `dirty` field; `clean` starts from one a completed registration wrote.
		start: (topics: readonly string[], options: { readonly clean?: boolean } = {}) => {
			membership = new Set(topics);
			doc = { token: "token-1", topics: [...topics] };
			if (options.clean) {
				doc["dirty"] = false;
			}
		},
		register: (
			input: Omit<RegisterPushTokenInput, "token">,
			options: RegistrationFailures = {},
		) => {
			failures = options;
			calls = [];
			writes = [];
			trace = [];
			maxInFlight = 0;
			return Effect.runPromise(
				PushTokenService.use((service) =>
					service.registerToken({ token: "token-1", ...input }),
				).pipe(Effect.ignore, Effect.provide(layer)),
			).then(() => ({ membership: [...membership], calls, writes, doc, trace, maxInFlight }));
		},
	};
}

const settingsRegistration = (campus: CampusSlug, ...channels: string[]) => ({
	channels: ["notify-prefs-v1", ...channels],
	campus: { slug: campus, version: 1 },
	campusStreamNotifications: true,
});

const documentKinds = [
	["written before write-ahead marking", false],
	["left clean by a registration", true],
] as const;

describe("registration transitions", () => {
	it.each(documentKinds)(
		"removes a category kept from a registration whose Firestore write failed (%s)",
		async (_kind, clean) => {
			const harness = createMembershipHarness();
			harness.start(legacyApp, { clean });
			await harness.register(settingsRegistration("new-breed", "verse-of-the-day"), {
				failMerge: true,
			});

			const { membership } = await harness.register(settingsRegistration("new-breed"));

			expect(membership).not.toContain("verse-of-the-day");
			expect(matches(categoryCondition("verse-of-the-day"), membership)).toBe(false);
		},
	);

	it.each(documentKinds)(
		"removes a follow kept from a registration whose Firestore write failed (%s)",
		async (_kind, clean) => {
			const harness = createMembershipHarness();
			harness.start(legacyApp, { clean });
			await harness.register(settingsRegistration("new-breed", "follow-house-of-stars"), {
				failMerge: true,
			});

			const { membership } = await harness.register(settingsRegistration("new-breed"));

			expect(deliveries("house-of-stars", true, membership)).toBe(0);
		},
	);

	it("removes a channel kept from a registration whose Firestore write failed", async () => {
		const harness = createMembershipHarness();
		harness.start(legacyApp, { clean: true });
		await harness.register({ channels: ["campus-light-house"] }, { failMerge: true });

		const { membership } = await harness.register({ channels: [] });

		expect(membership).toEqual(legacyApp);
	});

	it("keeps a failed registration's channel marked until a registration removes it", async () => {
		const harness = createMembershipHarness();
		harness.start(legacyApp, { clean: true });
		await harness.register({ channels: ["campus-light-house"] }, { failMerge: true });
		await harness.register({ channels: [] }, { failCall: "-campus-light-house" });

		const { membership } = await harness.register({ channels: [] });

		expect(membership).toEqual(legacyApp);
	});

	it("makes no FCM calls when a registration repeats", async () => {
		const harness = createMembershipHarness();
		harness.start(legacyApp);
		const input = settingsRegistration("new-breed", "livestreams", "follow-house-of-stars");
		const first = await harness.register(input);

		const repeated = await harness.register(input);

		expect(first.calls).not.toEqual([]);
		expect(repeated.calls).toEqual([]);
		expect(repeated.writes).toEqual([expect.objectContaining({ dirty: false })]);
		expect(repeated.membership.toSorted()).toEqual(first.membership.toSorted());
	});

	it("repairs a device whose first registration failed before its Firestore write", async () => {
		const harness = createMembershipHarness();
		const failed = await harness.register(
			{ channels: ["campus-light-house"] },
			{ failMerge: true },
		);
		expect(failed.membership).toContain("campus-light-house");
		expect(failed.doc).not.toHaveProperty("createdAt");

		const { membership, doc } = await harness.register({ channels: [] });

		expect(membership).toEqual(legacyApp);
		expect(doc).toMatchObject({ dirty: false, pendingTopics: [], createdAt: "server-timestamp" });
	});

	it("only subscribes a device registering for the first time", async () => {
		const harness = createMembershipHarness();

		const { calls, membership } = await harness.register(settingsRegistration("new-breed"));

		expect(calls.every((call) => call.startsWith("+"))).toBe(true);
		expect(membership.toSorted()).toEqual(settingsApp("new-breed").toSorted());
	});

	it("changes only the category the user switched", async () => {
		const harness = createMembershipHarness();
		harness.start(settingsApp("new-breed", "livestreams"), { clean: true });

		const switchedOn = await harness.register(
			settingsRegistration("new-breed", "livestreams", "verse-of-the-day"),
		);
		const switchedOff = await harness.register(settingsRegistration("new-breed", "livestreams"));

		expect(switchedOn.calls).toEqual(["+verse-of-the-day"]);
		expect(switchedOff.calls).toEqual(["-verse-of-the-day"]);
	});

	it("joins the marker before the first category a device keeps", async () => {
		const harness = createMembershipHarness();
		harness.start(campusApp("new-breed"), { clean: true });

		const { calls } = await harness.register(settingsRegistration("new-breed", "livestreams"));

		expect(calls).toEqual(["+notify-prefs-v1", "+livestreams"]);
	});

	it("moves a device to its new campus without touching other topics", async () => {
		const harness = createMembershipHarness();
		harness.start(settingsApp("new-breed", "livestreams"), { clean: true });

		const { calls, membership } = await harness.register(
			settingsRegistration("light-house", "livestreams"),
		);

		expect(calls.toSorted()).toEqual(["+campus-light-house", "-campus-new-breed"]);
		expect(membership.toSorted()).toEqual(settingsApp("light-house", "livestreams").toSorted());
	});

	it("keeps app 2.0.x registrations and deliveries exactly as they are today", async () => {
		const harness = createMembershipHarness();
		harness.start(campusApp("house-of-stars"));

		// App 2.0.0 and 2.0.1 register no channels and follow their preferred campus.
		const { membership } = await harness.register({
			channels: [],
			campus: { slug: "house-of-stars", version: 1 },
			campusStreamNotifications: true,
		});

		expect(membership.toSorted()).toEqual(campusApp("house-of-stars").toSorted());
		expect(matches(categoryCondition("verse-of-the-day"), membership)).toBe(true);
		expect(allowsCategory(membership, "word-of-activation")).toBe(true);
		expect(deliveries("house-of-stars", true, membership)).toBe(1);
		expect(deliveries("house-of-stars", false, membership)).toBe(1);
		expect(deliveries("new-breed", true, membership)).toBe(0);
	});

	it("removes unwanted preference topics together rather than one at a time", async () => {
		const harness = createMembershipHarness();
		harness.start(settingsApp("new-breed", "livestreams", "follow-light-house"));

		const { membership, maxInFlight } = await harness.register({
			campus: { slug: "new-breed", version: 1 },
			campusStreamNotifications: true,
		});

		expect(maxInFlight).toBeGreaterThan(1);
		expect(membership.toSorted()).toEqual(campusApp("new-breed").toSorted());
	});

	it("limits how many topics one registration removes at once", async () => {
		const harness = createMembershipHarness();
		harness.start([
			...settingsApp("new-breed", "livestreams"),
			...Array.from({ length: 200 }, (_, i) => `channel-${i}`),
		]);

		const { membership, maxInFlight } = await harness.register(settingsRegistration("new-breed"));

		expect(maxInFlight).toBe(17);
		expect(membership).not.toContain("channel-0");
	});

	it("leaves the own campus to the livestreams category when it was also followed", async () => {
		const harness = createMembershipHarness();
		harness.start(settingsApp("light-house", "follow-new-breed"));

		const { membership } = await harness.register(
			settingsRegistration("new-breed", "follow-new-breed"),
		);

		expect(membership).not.toContain("follow-new-breed");
		expect(deliveries("new-breed", true, membership)).toBe(0);
	});

	// Registration stops at its first failed call, so every state it can be left
	// in is one of the recorded intermediate states, including the audience marker call.
	it("never puts a device in both stream audiences at any step", async () => {
		const transitions: [string, readonly string[], Omit<RegisterPushTokenInput, "token">][] = [
			["older app to settings", legacyApp, settingsRegistration("house-of-stars", "livestreams")],
			[
				"older app to following Union",
				legacyApp,
				settingsRegistration("new-breed", "follow-house-of-stars"),
			],
			[
				"campus app to settings",
				campusApp("house-of-stars"),
				settingsRegistration("house-of-stars", "livestreams"),
			],
			[
				"settings back to an older app",
				settingsApp("house-of-stars", "livestreams", "follow-new-breed"),
				{},
			],
			[
				"settings back to a campus app",
				settingsApp("new-breed", "follow-house-of-stars"),
				{ campus: { slug: "new-breed", version: 2 }, campusStreamNotifications: true },
			],
		];
		const traces = await Promise.all(
			transitions.flatMap(([name, start, input]) =>
				documentKinds.map(async ([kind, clean]) => {
					const harness = createMembershipHarness();
					harness.start(start, { clean });
					const { trace } = await harness.register(input);
					return [`${name}, ${kind}`, trace] as const;
				}),
			),
		);
		for (const [name, trace] of traces) {
			for (const state of trace) {
				for (const campus of ["house-of-stars", "new-breed"] as const) {
					for (const enabled of [true, false]) {
						expect([name, state, deliveries(campus, enabled, state) <= 1]).toEqual([
							name,
							state,
							true,
						]);
					}
				}
			}
		}
	});
});
