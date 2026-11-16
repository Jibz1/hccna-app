import { FirebaseAdminContext } from "@/effect/FirebaseAdminContext";
import { FirebaseAuthError, FirebaseAuthService } from "@/effect/services/FirebaseAuthService";
import { MailService } from "@/effect/services/MailService";
import { PushTokenService } from "@/effect/services/PushTokenService";
import {
	WordOfActivationRetryDelay,
	WordOfActivationService,
	WordOfActivationServiceLive,
} from "@/effect/services/WordOfActivationService";
import { sentry } from "@/graphql/__tests__/utils/sentry-mocks";
import * as BunCrypto from "@effect/platform-bun/BunCrypto";
import { beforeEach, describe, expect, it } from "bun:test";
import { Effect, Fiber, Layer } from "effect";

import type { PushSendReport, SendToUserInput } from "@/effect/services/push/firebase";

interface VerseDoc {
	readonly book: string;
	readonly img: readonly string[];
	readonly stBook: readonly string[];
	readonly text: string;
	readonly nlt_translation: string;
}

interface MonthlyDeliveryDoc {
	readonly monthKey: string;
	readonly monthLabel: string;
	readonly verseId: string;
	readonly emailPending: boolean;
	readonly pushPending: boolean;
	readonly leaseOwner: string;
	readonly leaseUntil: number;
}

interface SubscriptionDoc {
	readonly email: string;
	readonly Name: string;
	readonly monthlySub: boolean;
	readonly lastUpdate: number;
	readonly wordActivationId: string;
	readonly monthlyDelivery?: MonthlyDeliveryDoc;
}

interface FirestoreStore {
	readonly verses: Map<string, VerseDoc>;
	readonly subscriptions: Map<string, SubscriptionDoc>;
}

interface DocRef {
	readonly collection: string;
	readonly id: string;
}

const { captureMessage, captureException } = sentry;

const VERSES = "wordActivationScriptures";
const SUBSCRIPTIONS = "wordActivationSub";
// Any timestamp in an earlier month makes the run assign a new verse.
const PREVIOUS_MONTH = Date.UTC(2020, 0, 15);
// The delivery month key, e.g. "2026-10", as the run computes it in Eastern time.
const CURRENT_MONTH = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/New_York",
	year: "numeric",
	month: "2-digit",
}).format(new Date());

/**
 * In-memory Firestore covering the calls the rotation makes. Transactions run
 * one at a time, matching Firestore's serializable outcome for contended docs.
 */
function makeFirestore(store: FirestoreStore) {
	let queue = Promise.resolve();
	const docs = (collection: string): ReadonlyMap<string, VerseDoc | SubscriptionDoc> =>
		collection === VERSES ? store.verses : store.subscriptions;
	const snapshot = ({ collection, id }: DocRef) => {
		const data = docs(collection).get(id);
		return { id, exists: data !== undefined, data: () => structuredClone(data) };
	};
	// The rotation only ever updates subscription documents.
	const update = ({ id }: DocRef, data: Partial<SubscriptionDoc>) => {
		const current = store.subscriptions.get(id);
		if (current) {
			store.subscriptions.set(id, { ...current, ...data });
		}
	};
	const refs = (collection: string) =>
		[...docs(collection).keys()].map((id) => ({ collection, id }));
	return {
		collection: (collection: string) => ({
			select: () => ({ get: () => Promise.resolve({ docs: refs(collection) }) }),
			get: () => Promise.resolve({ docs: refs(collection).map((ref) => snapshot(ref)) }),
			doc: (id: string) => ({
				collection,
				id,
				get: () => Promise.resolve(snapshot({ collection, id })),
			}),
		}),
		runTransaction: <A>(
			run: (transaction: {
				get: (ref: DocRef) => Promise<ReturnType<typeof snapshot>>;
				update: (ref: DocRef, data: Partial<SubscriptionDoc>) => void;
			}) => Promise<A>,
		) => {
			const result = queue.then(async () => {
				const writes: (() => void)[] = [];
				const outcome = await run({
					get: (ref) => Promise.resolve(snapshot(ref)),
					update: (ref, data) => {
						writes.push(() => update(ref, data));
					},
				});
				for (const apply of writes) {
					apply();
				}
				return outcome;
			});
			queue = result.then(
				() => {},
				() => {},
			);
			return result;
		},
	};
}

interface HarnessOptions {
	/** Firebase Auth UID by subscriber email; other emails are email-only subscribers. */
	readonly users?: Readonly<Record<string, string>>;
	/** FCM outcome by Auth UID. Defaults to one accepted device. */
	readonly pushReports?: Readonly<Record<string, PushSendReport>>;
	/** How many sends to each address fail before one succeeds. */
	readonly mailFailures?: Readonly<Record<string, number>>;
	/** Holds every email send until this settles. */
	readonly holdMail?: Promise<void>;
	/** Leaves the verse collection empty. */
	readonly noVerses?: boolean;
}

function harness(
	subscriptions: Readonly<Record<string, SubscriptionDoc>>,
	options: HarnessOptions = {},
) {
	const store: FirestoreStore = {
		verses: new Map(
			options.noVerses
				? []
				: [
						[
							"verse-1",
							{
								book: "Isaiah 60:1",
								img: ["https://example.com/verse-1.png"],
								stBook: ["Isaiah"],
								text: "Arise, shine; for your light has come.",
								nlt_translation: "Arise, Jerusalem! Let your light shine for all to see.",
							},
						],
					],
		),
		subscriptions: new Map(Object.entries(subscriptions)),
	};
	const firestore = makeFirestore(store);
	const mailAttempts: string[] = [];
	const pushed: SendToUserInput[] = [];
	const users = options.users ?? {};

	const dependencies = Layer.mergeAll(
		BunCrypto.layer,
		Layer.succeed(FirebaseAdminContext, {
			db: firestore,
			secondaryDb: firestore,
			AppCollections: { wordActivationScriptures: VERSES, wordActivationSub: SUBSCRIPTIONS },
		} as never),
		// The rotation only sends mail; the template config is real.
		Layer.succeed(MailService, {
			send: (data: { to: string }) =>
				Effect.promise(() => options.holdMail ?? Promise.resolve()).pipe(
					Effect.andThen(() => {
						mailAttempts.push(data.to);
						const failuresBefore = options.mailFailures?.[data.to] ?? 0;
						const attempt = mailAttempts.filter((to) => to === data.to).length;
						return attempt <= failuresBefore
							? Effect.fail(new Error("SendGrid 503"))
							: Effect.succeed([{}, {}]);
					}),
				),
		} as never),
		// The rotation resolves push recipients by email only.
		Layer.succeed(FirebaseAuthService, {
			getUserByEmail: (email: string) => {
				const uid = users[email];
				return uid
					? Effect.succeed({ uid, email, disabled: false })
					: Effect.fail(
							new FirebaseAuthError({ operation: "getUserByEmail", code: "auth/user-not-found" }),
						);
			},
		} as never),
		// The rotation only sends to users; token registration is out of scope.
		Layer.succeed(PushTokenService, {
			sendToUser: (input: SendToUserInput) =>
				Effect.sync(() => {
					pushed.push(input);
					return (
						options.pushReports?.[input.userId] ?? {
							successCount: 1,
							failureCount: 0,
							prunedTokens: [],
						}
					);
				}),
		} as never),
	);
	const layer = WordOfActivationServiceLive.pipe(Layer.provide(dependencies));
	const run = <A, E>(effect: Effect.Effect<A, E, WordOfActivationService>) =>
		Effect.runPromise(
			effect.pipe(Effect.provide(layer), Effect.provideService(WordOfActivationRetryDelay, 0)),
		);

	return {
		run,
		mailAttempts,
		pushed,
		subscription: (profileID: string) => store.subscriptions.get(profileID),
		delivery: (profileID: string) => store.subscriptions.get(profileID)?.monthlyDelivery,
	};
}

const subscriber = (email: string): SubscriptionDoc => ({
	email,
	Name: "Member",
	monthlySub: true,
	lastUpdate: PREVIOUS_MONTH,
	wordActivationId: "verse-0",
});

const assignedThisMonth = (
	email: string,
	pending: Pick<MonthlyDeliveryDoc, "emailPending" | "pushPending">,
): SubscriptionDoc => ({
	email,
	Name: "Member",
	monthlySub: true,
	lastUpdate: Date.now(),
	wordActivationId: "verse-1",
	monthlyDelivery: {
		monthKey: CURRENT_MONTH,
		monthLabel: "This month",
		verseId: "verse-1",
		leaseOwner: "",
		leaseUntil: 0,
		...pending,
	},
});

describe("WordOfActivationService.runMonthlyRotation", () => {
	it("acknowledges a push whose only failures were dead device tokens", async () => {
		const h = harness(
			{ "profile-1": subscriber("member@example.com") },
			{
				users: { "member@example.com": "uid-1" },
				pushReports: {
					// One live device accepted; FCM rejected an uninstalled one, which was pruned.
					"uid-1": { successCount: 1, failureCount: 1, prunedTokens: ["dead-token"] },
				},
			},
		);

		const summary = await h.run(
			WordOfActivationService.use((service) => service.runMonthlyRotation),
		);

		expect(summary).toMatchObject({ emailed: 1, notified: 1, failed: 0 });
		expect(h.delivery("profile-1")).toMatchObject({ emailPending: false, pushPending: false });
	});

	it("keeps the push pending when FCM rejects a live device", async () => {
		const h = harness(
			{ "profile-1": subscriber("member@example.com") },
			{
				users: { "member@example.com": "uid-1" },
				pushReports: { "uid-1": { successCount: 0, failureCount: 1, prunedTokens: [] } },
			},
		);

		const summary = await h.run(
			WordOfActivationService.use((service) => service.runMonthlyRotation),
		);

		expect(summary).toMatchObject({ emailed: 1, notified: 0, failed: 1 });
		expect(h.delivery("profile-1")).toMatchObject({ emailPending: false, pushPending: true });
	});

	it("retries a failed delivery once and leaves delivered subscribers alone", async () => {
		const h = harness(
			{
				"profile-1": subscriber("flaky@example.com"),
				"profile-2": subscriber("steady@example.com"),
			},
			{ mailFailures: { "flaky@example.com": 1 } },
		);

		const report = await h.run(
			WordOfActivationService.use((service) => service.runMonthlyRotation),
		);

		expect(report).toMatchObject({ assigned: 2, emailed: 2, failed: 0, failedProfileIds: [] });
		expect(h.mailAttempts.toSorted()).toEqual([
			"flaky@example.com",
			"flaky@example.com",
			"steady@example.com",
		]);
		expect(h.delivery("profile-1")).toMatchObject({ emailPending: false });
	});

	it("reports subscribers that still fail after the retry", async () => {
		const h = harness(
			{ "profile-1": subscriber("down@example.com") },
			{ mailFailures: { "down@example.com": Number.POSITIVE_INFINITY } },
		);

		const report = await h.run(
			WordOfActivationService.use((service) => service.runMonthlyRotation),
		);

		expect(report).toMatchObject({ emailed: 0, failed: 1, failedProfileIds: ["profile-1"] });
		expect(h.mailAttempts).toEqual(["down@example.com", "down@example.com"]);
		expect(h.delivery("profile-1")).toMatchObject({ emailPending: true });
	});
});

describe("WordOfActivationService.sendPendingDeliveries", () => {
	it("sends only this month's pending channels without assigning verses", async () => {
		const h = harness(
			{
				pending: assignedThisMonth("pending@example.com", {
					emailPending: true,
					pushPending: false,
				}),
				delivered: assignedThisMonth("done@example.com", {
					emailPending: false,
					pushPending: false,
				}),
				unassigned: subscriber("later@example.com"),
			},
			{ users: { "pending@example.com": "uid-1" } },
		);

		const report = await h.run(
			WordOfActivationService.use((service) => service.sendPendingDeliveries),
		);

		expect(report).toMatchObject({ assigned: 0, emailed: 1, failed: 0, failedProfileIds: [] });
		expect(h.mailAttempts).toEqual(["pending@example.com"]);
		expect(h.pushed).toEqual([]);
		expect(h.delivery("pending")).toMatchObject({ emailPending: false, pushPending: false });
		expect(h.subscription("unassigned")).toMatchObject({ wordActivationId: "verse-0" });
	});
});

describe("WordOfActivationService background runs", () => {
	beforeEach(() => {
		captureMessage.mockClear();
		captureException.mockClear();
	});

	it("starts the monthly rotation without waiting for delivery", async () => {
		let releaseMail = () => {};
		const holdMail = new Promise<void>((resolve) => {
			releaseMail = resolve;
		});
		const h = harness({ "profile-1": subscriber("member@example.com") }, { holdMail });

		await h.run(
			Effect.gen(function* () {
				const service = yield* WordOfActivationService;
				const run = yield* service.startMonthlyRotation;
				expect(h.mailAttempts).toEqual([]);
				releaseMail();
				yield* Fiber.join(run);
			}),
		);

		expect(h.delivery("profile-1")).toMatchObject({ emailPending: false });
	});

	it("starts a send-pending run in the background without assigning verses", async () => {
		const h = harness({
			pending: assignedThisMonth("pending@example.com", { emailPending: true, pushPending: false }),
			unassigned: subscriber("later@example.com"),
		});

		await h.run(
			WordOfActivationService.use((service) =>
				service.startPendingDeliveries.pipe(Effect.flatMap(Fiber.join)),
			),
		);

		expect(h.mailAttempts).toEqual(["pending@example.com"]);
		expect(h.subscription("unassigned")).toMatchObject({ wordActivationId: "verse-0" });
	});

	it("alerts Sentry once with the subscriptions still failing after the retry", async () => {
		const h = harness(
			{
				"profile-1": subscriber("down@example.com"),
				"profile-2": subscriber("fine@example.com"),
			},
			{ mailFailures: { "down@example.com": Number.POSITIVE_INFINITY } },
		);

		await h.run(
			WordOfActivationService.use((service) =>
				service.startMonthlyRotation.pipe(Effect.flatMap(Fiber.join)),
			),
		);

		expect(captureMessage).toHaveBeenCalledTimes(1);
		expect(captureMessage.mock.calls[0]?.[1]).toMatchObject({
			level: "error",
			tags: { job: "woa-delivery", run: "monthly rotation", monthKey: CURRENT_MONTH },
			fingerprint: ["woa-delivery-failed", CURRENT_MONTH],
			extra: { failed: 1, failedProfileIds: ["profile-1"] },
		});
		// Subscriber email addresses stay out of Sentry.
		expect(JSON.stringify(captureMessage.mock.calls)).not.toContain("@example.com");
		expect(captureException).not.toHaveBeenCalled();
	});

	it("does not alert when every delivery succeeds", async () => {
		const h = harness({ "profile-1": subscriber("member@example.com") });

		await h.run(
			WordOfActivationService.use((service) =>
				service.startMonthlyRotation.pipe(Effect.flatMap(Fiber.join)),
			),
		);

		expect(h.mailAttempts).toEqual(["member@example.com"]);
		expect(captureMessage).not.toHaveBeenCalled();
		expect(captureException).not.toHaveBeenCalled();
	});

	it("reports a run that fails outright to Sentry", async () => {
		const h = harness({ "profile-1": subscriber("member@example.com") }, { noVerses: true });

		await h.run(
			WordOfActivationService.use((service) =>
				service.startMonthlyRotation.pipe(Effect.flatMap(Fiber.join)),
			),
		);

		expect(captureException).toHaveBeenCalledTimes(1);
		expect(captureException.mock.calls[0]?.[1]).toMatchObject({
			tags: { job: "woa-delivery", run: "monthly rotation" },
		});
		expect(h.mailAttempts).toEqual([]);
	});
});

const firestoreUnavailable = () => Promise.reject(new Error("Firestore unavailable"));
const unavailableFirestore = {
	collection: () => ({ where: () => ({ get: firestoreUnavailable }) }),
};

describe("WordOfActivationService.getByEmail", () => {
	it("fails without the member's email in the error", async () => {
		const firebase = Layer.succeed(FirebaseAdminContext, {
			db: unavailableFirestore,
			secondaryDb: unavailableFirestore,
			AppCollections: { wordActivationScriptures: VERSES, wordActivationSub: SUBSCRIPTIONS },
		} as never);
		// A lookup touches only Firestore; the delivery services stay empty.
		const dependencies = Layer.mergeAll(
			BunCrypto.layer,
			firebase,
			Layer.succeed(MailService, {} as never),
			Layer.succeed(FirebaseAuthService, {} as never),
			Layer.succeed(PushTokenService, {} as never),
		);
		const layer = WordOfActivationServiceLive.pipe(Layer.provide(dependencies));

		const failure = await Effect.runPromise(
			WordOfActivationService.use((service) => service.getByEmail("ada@example.com")).pipe(
				Effect.flip,
				Effect.provide(layer),
			),
		);

		expect(failure).toMatchObject({ _tag: "WordOfActivationLookupError" });
		expect(JSON.stringify(failure)).not.toContain("ada@example.com");
		expect(failure.message).not.toContain("ada@example.com");
	});
});

type DocValue = string | boolean | readonly string[];
type DocData = Readonly<Record<string, DocValue>>;

/** The Firestore calls a lookup and a new subscription make: queries, `add`, `doc().update()`. */
function makeQueryFirestore(collections: Record<string, Map<string, DocData>>) {
	let nextId = 0;
	const docsOf = (name: string) => collections[name] ?? new Map<string, DocData>();
	const snapshotOf = (name: string, id: string) => {
		const data = docsOf(name).get(id);
		return {
			id,
			exists: data !== undefined,
			data: () => structuredClone(data),
		};
	};
	const query = (
		name: string,
		matches: (id: string, data: DocData) => boolean,
		limit?: number,
	) => ({
		limit: (count: number) => query(name, matches, count),
		get: () => {
			const docs = [...docsOf(name).entries()]
				.filter(([id, data]) => matches(id, data))
				.toSorted(([a], [b]) => (a < b ? -1 : 1))
				.slice(0, limit)
				.map(([id]) => snapshotOf(name, id));
			return Promise.resolve({
				empty: docs.length === 0,
				docs,
				forEach: (visit: (doc: (typeof docs)[number]) => void) => {
					for (const doc of docs) {
						visit(doc);
					}
				},
			});
		},
	});
	return {
		collection: (name: string) => ({
			where: (field: string, op: string, value: string) =>
				query(name, (id, data) => {
					if (field !== DOCUMENT_ID) {
						return data[field] === value;
					}
					return op === "<" ? id < value : id >= value;
				}),
			add: (data: DocData) => {
				nextId += 1;
				const id = `auto-${nextId}`;
				collections[name]?.set(id, structuredClone(data));
				return Promise.resolve({ id });
			},
			doc: (id?: string) => {
				nextId += 1;
				const docId = id ?? `key-${nextId}`;
				return {
					id: docId,
					get: () => Promise.resolve(snapshotOf(name, docId)),
					update: (data: DocData) => {
						const current = docsOf(name).get(docId);
						if (current) {
							collections[name]?.set(docId, { ...current, ...data });
						}
						return Promise.resolve();
					},
				};
			},
		}),
	};
}

const DOCUMENT_ID = "__name__";
const USERS = "app-users";

const verse = (book: string, text: string) => ({
	book,
	img: ["https://example.com/verse.png"],
	stBook: [book.split(" ")[0] ?? book],
	text,
	nlt_translation: text,
});

/** `getByEmail` for Ada, with separate primary and secondary Firebase projects. */
function makeGetByEmail(subscriptions: {
	readonly primary: Map<string, DocData>;
	readonly secondary: Map<string, DocData>;
}) {
	const primary = makeQueryFirestore({
		[USERS]: new Map([
			["ada-example-uid", { email: "ada@example.com", firstName: "Ada", lastName: "Example" }],
		]),
		[VERSES]: new Map([
			["verse-1", verse("Isaiah 60:1", "Arise, shine; for your light has come.")],
			["verse-2", verse("Psalm 118:24", "This is the day the Lord has made.")],
		]),
		[SUBSCRIPTIONS]: subscriptions.primary,
	});
	const secondary = makeQueryFirestore({
		[SUBSCRIPTIONS]: subscriptions.secondary,
	});
	const dependencies = Layer.mergeAll(
		BunCrypto.layer,
		Layer.succeed(FirebaseAdminContext, {
			db: primary,
			secondaryDb: secondary,
			fieldPath: { documentId: () => DOCUMENT_ID },
			AppCollections: {
				users: USERS,
				wordActivationScriptures: VERSES,
				wordActivationSub: SUBSCRIPTIONS,
			},
		} as never),
		Layer.succeed(MailService, {} as never),
		Layer.succeed(FirebaseAuthService, {} as never),
		Layer.succeed(PushTokenService, {} as never),
	);
	const layer = WordOfActivationServiceLive.pipe(Layer.provide(dependencies));
	return () =>
		Effect.runPromise(
			WordOfActivationService.use((service) => service.getByEmail("ada@example.com")).pipe(
				Effect.provide(layer),
			),
		);
}

describe("WordOfActivationService.getByEmail subscriptions", () => {
	it("subscribes a new member in the project the rotation reads", async () => {
		const primarySubscriptions = new Map<string, DocData>();
		const secondarySubscriptions = new Map<string, DocData>();
		const getByEmail = makeGetByEmail({
			primary: primarySubscriptions,
			secondary: secondarySubscriptions,
		});

		const expected = {
			book: "Isaiah 60:1",
			email: "ada@example.com",
			monthlySub: true,
			name: "Ada Example",
			verseId: "verse-1",
		};
		expect(await getByEmail()).toMatchObject(expected);
		expect([...secondarySubscriptions.values()]).toEqual([
			{
				Name: "Ada Example",
				email: "ada@example.com",
				monthlySub: true,
				wordActivationId: "verse-1",
			},
		]);
		expect(primarySubscriptions.size).toBe(0);

		// The next lookup finds the subscription where getByEmail looks first.
		expect(await getByEmail()).toMatchObject(expected);
		expect(secondarySubscriptions.size).toBe(1);
	});

	it("keeps the verse of a member subscribed only in the primary project", async () => {
		const subscription = {
			Name: "Ada Example",
			email: "ada@example.com",
			monthlySub: true,
			wordActivationId: "verse-2",
		};
		const primarySubscriptions = new Map<string, DocData>([["primary-sub", subscription]]);
		const secondarySubscriptions = new Map<string, DocData>();
		const getByEmail = makeGetByEmail({
			primary: primarySubscriptions,
			secondary: secondarySubscriptions,
		});

		expect(await getByEmail()).toMatchObject({
			book: "Psalm 118:24",
			email: "ada@example.com",
			monthlySub: true,
			verseId: "verse-2",
		});
		// No new subscription, so woa:copy-subscriptions still copies this one.
		expect(secondarySubscriptions.size).toBe(0);
		expect([...primarySubscriptions.entries()]).toEqual([["primary-sub", subscription]]);
	});
});
