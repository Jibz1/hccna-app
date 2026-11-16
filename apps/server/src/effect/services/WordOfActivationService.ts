import { FirebaseAdminContext } from "@/effect/FirebaseAdminContext";
import { FirebaseAuthService } from "@/effect/services/FirebaseAuthService";
import { MailService, type MailDataRequired } from "@/effect/services/MailService";
import { NotificationCategoryTopic } from "@/effect/services/push/topics";
import { PushTokenService } from "@/effect/services/PushTokenService";
import { FIRST_INDEX } from "@/utils/constants";
import { config as emailTemplateConfig } from "@/utils/messages/email/EmailTemplate";
import { omitUndefined } from "@/utils/omitUndefined";
import {
	getOrAssignWordOfActivationEffect,
	VerseDataSchema,
	WordActivationSubSchema,
	type VerseData,
	type WordActivationSub,
} from "@/utils/wordOfActivation/wordOfActivation";
import * as Sentry from "@sentry/bun";
import { formatInTimeZone } from "date-fns-tz";
import {
	Cause,
	Context,
	Crypto,
	DateTime,
	type Duration,
	Effect,
	type Fiber,
	Layer,
	Option,
	Predicate,
	Result,
	Schema,
	type Scope,
} from "effect";

import type { PushSendReport } from "@/effect/services/push/firebase";

export interface WordOfActivationData {
	book: string;
	stBook: string;
	month: string;
	name: string;
	monthlySub: boolean;
	email: string;
	text: string;
	image?: string | undefined;
	verseId?: string | undefined;
}

export const wordOfActivationMonth = (timestamp: number): string =>
	formatInTimeZone(timestamp, "America/New_York", "MMMM, yyyy");

class WordOfActivationLookupError extends Schema.TaggedError<WordOfActivationLookupError>()(
	"WordOfActivationLookupError",
	{
		operation: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {
	// No email: this error reaches logs, Loki and Sentry.
	override get message() {
		return `Word of activation lookup (${this.operation}) failed`;
	}
}

class WordOfActivationRotationError extends Schema.TaggedError<WordOfActivationRotationError>()(
	"WordOfActivationRotationError",
	{
		operation: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
) {
	override get message() {
		return `Word of activation monthly rotation (${this.operation}) failed`;
	}
}

interface MonthlyRotationSummary {
	readonly assigned: number;
	readonly emailed: number;
	readonly notified: number;
	readonly skipped: number;
	readonly failed: number;
}

interface MonthlyRotationReport extends MonthlyRotationSummary {
	/** The delivery month, as `yyyy-MM` in Eastern time. */
	readonly monthKey: string;
	/** Subscriptions whose delivery still failed after the retry. */
	readonly failedProfileIds: readonly string[];
}

// Run names label logs and Sentry events.
type DeliveryRun = "monthly rotation" | "pending delivery";

interface UserProfileSnapshot {
	readonly firstName?: string;
	readonly lastName?: string;
}

interface SubscriberSnapshot {
	readonly id: string;
	readonly data: () => unknown;
}

const DELIVERY_LEASE_MS = 5 * 60_000;

/** How long a run waits before its single retry of failed deliveries. */
export const WordOfActivationRetryDelay = Context.Reference<Duration.Input>(
	"WordOfActivationService/RetryDelay",
	{ defaultValue: () => "1 minute" },
);

const MonthlyDeliverySchema = Schema.Struct({
	monthKey: Schema.String,
	monthLabel: Schema.String,
	verseId: Schema.String,
	emailPending: Schema.Boolean,
	pushPending: Schema.Boolean,
	leaseOwner: Schema.String,
	leaseUntil: Schema.Number,
});

const RotationSubscriberSchema = Schema.Struct({
	email: Schema.String,
	Name: Schema.String,
	lastUpdate: Schema.optional(Schema.Number),
	monthlySub: Schema.optional(Schema.Union([Schema.Boolean, Schema.String])),
	wordActivationId: Schema.optional(Schema.String),
	profileID: Schema.String,
});
type RotationSubscriber = typeof RotationSubscriberSchema.Type;

const emptyMonthlyRotationSummary = (): MonthlyRotationSummary => ({
	assigned: 0,
	emailed: 0,
	notified: 0,
	skipped: 0,
	failed: 0,
});

const addMonthlyRotationSummaries = (
	left: MonthlyRotationSummary,
	right: MonthlyRotationSummary,
): MonthlyRotationSummary => ({
	assigned: left.assigned + right.assigned,
	emailed: left.emailed + right.emailed,
	notified: left.notified + right.notified,
	skipped: left.skipped + right.skipped,
	failed: left.failed + right.failed,
});

interface SubscriberOutcome {
	readonly doc: SubscriberSnapshot;
	readonly summary: MonthlyRotationSummary;
}

// A retried subscriber keeps what its first attempt delivered; the retry decides failure.
const mergeRetry = (
	first: MonthlyRotationSummary,
	retry: MonthlyRotationSummary,
): MonthlyRotationSummary => ({
	assigned: first.assigned + retry.assigned,
	emailed: first.emailed + retry.emailed,
	notified: Math.max(first.notified, retry.notified),
	skipped: 0,
	failed: retry.failed,
});

const toReport = (
	outcomes: readonly SubscriberOutcome[],
	monthKey: string,
): MonthlyRotationReport => ({
	monthKey,
	...outcomes.reduce(
		(total, { summary }) => addMonthlyRotationSummaries(total, summary),
		emptyMonthlyRotationSummary(),
	),
	failedProfileIds: outcomes.filter(({ summary }) => summary.failed > 0).map(({ doc }) => doc.id),
});

const logReport = (run: DeliveryRun, report: MonthlyRotationReport) =>
	(report.failed > 0
		? Effect.logWarning(`Word of activation ${run} still has failed deliveries after retry`)
		: Effect.logInfo(`Word of activation ${run} complete`)
	).pipe(
		Effect.annotateLogs({
			assigned: report.assigned,
			emailed: report.emailed,
			notified: report.notified,
			skipped: report.skipped,
			failed: report.failed,
			failedProfileIds: report.failedProfileIds.join(","),
		}),
	);

const RESEND_HINT =
	"Force-run Cloud Scheduler job WordActivationSendPending (app-hccnj, us-east4) to resend";

const alertFailedDeliveries = (run: DeliveryRun, report: MonthlyRotationReport) =>
	Effect.sync(() =>
		Sentry.captureMessage(
			`Word of Activation ${run}: ${report.failed} subscriptions still failing after retry`,
			{
				level: "error",
				tags: { job: "woa-delivery", run, monthKey: report.monthKey },
				// One issue per month, however many runs fail.
				fingerprint: ["woa-delivery-failed", report.monthKey],
				extra: {
					assigned: report.assigned,
					emailed: report.emailed,
					notified: report.notified,
					failed: report.failed,
					failedProfileIds: report.failedProfileIds,
					resend: RESEND_HINT,
				},
			},
		),
	);

const reportRunFailure = (run: DeliveryRun, cause: Cause.Cause<WordOfActivationRotationError>) =>
	Effect.logError(`Word of activation ${run} failed`).pipe(
		Effect.annotateLogs({ cause: Cause.pretty(cause) }),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(Cause.squash(cause), { tags: { job: "woa-delivery", run } }),
			),
		),
	);

const retryFailedOnce = Effect.fn("WordOfActivationService.retryFailedOnce")(function* (
	outcomes: readonly SubscriberOutcome[],
	retry: (doc: SubscriberSnapshot) => Effect.Effect<MonthlyRotationSummary>,
) {
	const failed = outcomes.filter(({ summary }) => summary.failed > 0);
	if (failed.length === 0) {
		return outcomes;
	}
	yield* Effect.logWarning("Retrying failed Word of activation deliveries").pipe(
		Effect.annotateLogs({ subscribers: failed.length }),
	);
	yield* Effect.sleep(yield* WordOfActivationRetryDelay);
	const retried = new Map(
		yield* Effect.forEach(
			failed,
			({ doc, summary }) =>
				retry(doc).pipe(Effect.map((next) => [doc.id, mergeRetry(summary, next)] as const)),
			{ concurrency: 10 },
		),
	);
	return outcomes.map(({ doc, summary }) => ({ doc, summary: retried.get(doc.id) ?? summary }));
});

// Triggers only start a run. The application scope owns it, so shutdown interrupts
// it and leaves the remaining deliveries pending for a send-pending run.
const startInBackground = (
	scope: Scope.Scope,
	run: DeliveryRun,
	effect: Effect.Effect<MonthlyRotationReport, WordOfActivationRotationError>,
) =>
	effect.pipe(
		Effect.flatMap((report) =>
			report.failed > 0 ? alertFailedDeliveries(run, report) : Effect.void,
		),
		Effect.catchCause((cause) => reportRunFailure(run, cause)),
		Effect.asVoid,
		Effect.forkIn(scope),
	);

const formatCause = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

// FCM rejections for unregistered tokens are pruned: that device is gone, not awaiting delivery.
const undeliveredPushCount = (report: PushSendReport) =>
	report.failureCount - report.prunedTokens.length;

const pickRandomVerseId = (
	pool: readonly string[],
	excludeId: string | undefined,
): string | undefined => {
	const candidates = pool.filter((id) => id !== excludeId);
	const source = candidates.length > 0 ? candidates : pool;
	return source[Math.floor(Math.random() * source.length)];
};

interface WordOfActivationServiceContract {
	readonly getByEmail: (
		email: string,
	) => Effect.Effect<WordOfActivationData | null, WordOfActivationLookupError>;
	readonly runMonthlyRotation: Effect.Effect<MonthlyRotationReport, WordOfActivationRotationError>;
	/** Sends this month's still-pending emails and pushes without assigning verses. */
	readonly sendPendingDeliveries: Effect.Effect<
		MonthlyRotationReport,
		WordOfActivationRotationError
	>;
	/** Starts `runMonthlyRotation` in the background; outcomes go to logs and Sentry. */
	readonly startMonthlyRotation: Effect.Effect<Fiber.Fiber<void>>;
	/** Starts `sendPendingDeliveries` in the background; outcomes go to logs and Sentry. */
	readonly startPendingDeliveries: Effect.Effect<Fiber.Fiber<void>>;
}

const toWordOfActivationData = (
	subscription: WordActivationSub,
	verse: VerseData,
): WordOfActivationData => ({
	book: verse.book,
	month: wordOfActivationMonth(
		subscription.lastUpdate ?? DateTime.toEpochMillis(DateTime.nowUnsafe()),
	),
	stBook: verse.stBook.join(", "),
	text: verse.nlt_translation,
	image: verse.img[FIRST_INDEX],
	verseId: verse.verseId,
	name: subscription.Name,
	monthlySub: subscription.monthlySub === "true" || subscription.monthlySub === true,
	email: subscription.email,
});

const toSubscribedWordOfActivation = (
	email: string,
	name: string,
	wordActivation: VerseData,
): WordOfActivationData => ({
	book: wordActivation.book,
	month: wordOfActivationMonth(DateTime.toEpochMillis(DateTime.nowUnsafe())),
	stBook: wordActivation.stBook.join(", "),
	text: wordActivation.nlt_translation,
	image: wordActivation.img[FIRST_INDEX],
	verseId: wordActivation.verseId,
	name,
	monthlySub: true,
	email,
});

export class WordOfActivationService extends Context.Service<
	WordOfActivationService,
	WordOfActivationServiceContract
>()("WordOfActivationService", {
	make: Effect.gen(function* () {
		const scope = yield* Effect.scope;
		const crypto = yield* Crypto.Crypto;
		const firebase = yield* FirebaseAdminContext;
		const mail = yield* MailService;
		const auth = yield* FirebaseAuthService;
		const push = yield* PushTokenService;

		const loadVersePool = Effect.tryPromise({
			try: async () => {
				const snapshot = await firebase.db
					.collection(firebase.AppCollections.wordActivationScriptures)
					.select()
					.get();
				return snapshot.docs.map((doc) => doc.id);
			},
			catch: (cause) =>
				new WordOfActivationRotationError({
					operation: "loadVersePool",
					cause,
				}),
		});

		const loadSubscriberDocs = Effect.tryPromise({
			try: async () => {
				const snapshot = await firebase.secondaryDb
					.collection(firebase.AppCollections.wordActivationSub)
					.get();
				return snapshot.docs;
			},
			catch: (cause) =>
				new WordOfActivationRotationError({
					operation: "loadSubscribers",
					cause,
				}),
		});

		const decodeRotationSubscriber = Effect.fn("WordOfActivationService.decodeRotationSubscriber")(
			function* (doc: SubscriberSnapshot) {
				return yield* Effect.try({
					try: () => {
						const data = doc.data();
						const payload = Predicate.isObject(data)
							? { profileID: doc.id, ...data }
							: { profileID: doc.id };
						return Schema.decodeUnknownSync(RotationSubscriberSchema)(payload);
					},
					catch: (cause) =>
						new WordOfActivationRotationError({
							operation: "parseSubscription",
							cause,
						}),
				});
			},
		);

		const fetchVerseCached = Effect.fn("WordOfActivationService.fetchVerseCached")(function* (
			verseId: string,
			cache: Map<string, VerseData>,
		) {
			const cached = cache.get(verseId);
			if (cached) {
				return cached;
			}

			const snapshot = yield* Effect.tryPromise({
				try: () =>
					firebase.db
						.collection(firebase.AppCollections.wordActivationScriptures)
						.doc(verseId)
						.get(),
				catch: (cause) =>
					new WordOfActivationRotationError({
						operation: "fetchVerse",
						cause,
					}),
			});

			const verse = yield* Effect.try({
				try: () =>
					Schema.decodeUnknownSync(VerseDataSchema)({
						...snapshot.data(),
						verseId: snapshot.id,
					}),
				catch: (cause) =>
					new WordOfActivationRotationError({
						operation: "parseVerse",
						cause,
					}),
			});

			cache.set(verseId, verse);
			return verse;
		});

		const sendMonthlyEmail = Effect.fn("WordOfActivationService.sendMonthlyEmail")(function* (
			subscriber: RotationSubscriber,
			verse: VerseData,
			month: string,
		) {
			const emailData = {
				...emailTemplateConfig({ type: "WordofTheMonth" }),
				to: subscriber.email,
				subject: `${month} Word Activation`,
				substitutions: {
					greetings: `Hi ${subscriber.Name}`,
					month,
					bibleVerse: verse.text,
					scripture: verse.book,
					imgScrpture: verse.img[FIRST_INDEX] ?? "",
				},
			} satisfies MailDataRequired;

			return yield* mail.send(emailData).pipe(
				Effect.mapError(
					(cause) =>
						new WordOfActivationRotationError({
							operation: "sendEmail",
							cause,
						}),
				),
			);
		});

		const logSubscriberFailure = (
			doc: SubscriberSnapshot,
			error: WordOfActivationRotationError,
			assigned = 0,
		) =>
			Effect.logError("Word of activation rotation failed for subscriber").pipe(
				Effect.annotateLogs({
					profileID: doc.id,
					operation: error.operation,
					cause: formatCause(error.cause),
				}),
				Effect.as({ ...emptyMonthlyRotationSummary(), assigned, failed: 1 }),
			);

		const sendMonthlyPush = Effect.fn("WordOfActivationService.sendMonthlyPush")(function* (
			subscriber: RotationSubscriber,
			verse: VerseData,
			month: string,
		): Effect.fn.Return<PushSendReport, WordOfActivationRotationError> {
			const user = yield* auth.getUserByEmail(subscriber.email).pipe(
				Effect.map(Option.some),
				Effect.catchTag("FirebaseAuthError", (error) =>
					error.code === "auth/user-not-found"
						? Effect.succeed(Option.none())
						: Effect.fail(
								new WordOfActivationRotationError({ operation: "findPushRecipient", cause: error }),
							),
				),
			);
			// WOA subscriptions may belong to email-only subscribers or disabled accounts.
			if (Option.isNone(user) || user.value.disabled) {
				return { successCount: 0, failureCount: 0, prunedTokens: [] };
			}
			return yield* push
				.sendToUser({
					userId: user.value.uid,
					notification: omitUndefined({
						title: `${month} Word of Activation`,
						body: verse.nlt_translation,
						imageUrl: verse.img[FIRST_INDEX],
					}),
					data: { type: "woa" },
					category: NotificationCategoryTopic.wordOfActivation,
				})
				.pipe(
					Effect.mapError(
						(cause) => new WordOfActivationRotationError({ operation: "sendPush", cause }),
					),
				);
		});

		const assignMonthlyVerse = Effect.fn("WordOfActivationService.assignMonthlyVerse")(function* (
			doc: SubscriberSnapshot,
			input: {
				readonly currentMonthKey: string;
				readonly monthLabel: string;
				readonly now: number;
				readonly versePool: readonly string[];
			},
		): Effect.fn.Return<number, WordOfActivationRotationError> {
			const subscriber = yield* decodeRotationSubscriber(doc);
			const reference = firebase.secondaryDb
				.collection(firebase.AppCollections.wordActivationSub)
				.doc(subscriber.profileID);
			return yield* Effect.tryPromise({
				try: () =>
					firebase.secondaryDb.runTransaction(async (transaction) => {
						const snapshot = await transaction.get(reference);
						const current = Schema.decodeUnknownSync(RotationSubscriberSchema)({
							...snapshot.data(),
							profileID: subscriber.profileID,
						});
						const assignedMonth =
							current.lastUpdate === undefined
								? undefined
								: formatInTimeZone(current.lastUpdate, "America/New_York", "yyyy-MM");
						// A delayed run must not overwrite a newer month's assignment.
						if (assignedMonth !== undefined && assignedMonth >= input.currentMonthKey) {
							return 0;
						}
						const verseId = pickRandomVerseId(input.versePool, current.wordActivationId);
						if (!verseId) {
							throw new Error("No verse available");
						}
						const subscribed = current.monthlySub === true || current.monthlySub === "true";
						transaction.update(reference, {
							wordActivationId: verseId,
							lastUpdate: input.now,
							// The current WOA supersedes obsolete notifications, including active leases.
							monthlyDelivery: {
								monthKey: input.currentMonthKey,
								monthLabel: input.monthLabel,
								verseId,
								emailPending: subscribed,
								pushPending: subscribed,
								leaseOwner: "",
								leaseUntil: 0,
							},
						});
						return 1;
					}),
				catch: (cause) => new WordOfActivationRotationError({ operation: "assignVerse", cause }),
			});
		});

		const handleSubscriber = Effect.fn("WordOfActivationService.handleMonthlySubscriber")(
			function* (
				doc: SubscriberSnapshot,
				input: {
					readonly currentMonthKey: string;
					readonly assigned: number;
					readonly verseCache: Map<string, VerseData>;
				},
			): Effect.fn.Return<MonthlyRotationSummary, WordOfActivationRotationError> {
				const subscriber = yield* decodeRotationSubscriber(doc);
				const leaseOwner = yield* crypto
					.randomUUIDv4()
					.pipe(
						Effect.catchTag("PlatformError", (cause) =>
							Effect.fail(
								new WordOfActivationRotationError({ operation: "generateDeliveryLease", cause }),
							),
						),
					);
				const reference = firebase.secondaryDb
					.collection(firebase.AppCollections.wordActivationSub)
					.doc(subscriber.profileID);
				const claim = yield* Effect.tryPromise({
					try: () =>
						firebase.secondaryDb.runTransaction(async (transaction) => {
							const snapshot = await transaction.get(reference);
							const current = Schema.decodeUnknownSync(RotationSubscriberSchema)({
								...snapshot.data(),
								profileID: subscriber.profileID,
							});
							const data = snapshot.data();
							// Legacy assignments without delivery state are already complete.
							if (!data?.monthlyDelivery) {
								return null;
							}
							const pending = Schema.decodeUnknownSync(MonthlyDeliverySchema)(data.monthlyDelivery);
							if (
								pending.monthKey !== input.currentMonthKey ||
								pending.verseId !== current.wordActivationId ||
								(!pending.emailPending && !pending.pushPending) ||
								pending.leaseUntil > Date.now()
							) {
								return null;
							}
							const subscribed = current.monthlySub === true || current.monthlySub === "true";
							const delivery = {
								...pending,
								emailPending: subscribed && pending.emailPending,
								pushPending: subscribed && pending.pushPending,
								leaseOwner,
								leaseUntil: Date.now() + DELIVERY_LEASE_MS,
							};
							transaction.update(reference, { monthlyDelivery: delivery });
							return { subscriber: current, delivery };
						}),
					catch: (cause) =>
						new WordOfActivationRotationError({ operation: "claimDelivery", cause }),
				});
				if (!claim) {
					return {
						...emptyMonthlyRotationSummary(),
						assigned: input.assigned,
						skipped: input.assigned === 0 ? 1 : 0,
					};
				}

				const updateDelivery = (channel: "email" | "push" | "release") =>
					Effect.tryPromise({
						try: () =>
							firebase.secondaryDb.runTransaction(async (transaction) => {
								const snapshot = await transaction.get(reference);
								const data = snapshot.data();
								const delivery = Schema.decodeUnknownSync(MonthlyDeliverySchema)(
									data?.monthlyDelivery,
								);
								if (delivery.leaseOwner !== leaseOwner) {
									if (channel === "release") {
										return;
									}
									throw new Error("Monthly delivery claim has been superseded");
								}
								transaction.update(reference, {
									monthlyDelivery: {
										...delivery,
										emailPending: channel === "email" ? false : delivery.emailPending,
										pushPending: channel === "push" ? false : delivery.pushPending,
										leaseUntil: channel === "release" ? 0 : delivery.leaseUntil,
									},
								});
							}),
						catch: (cause) =>
							new WordOfActivationRotationError({ operation: "recordDelivery", cause }),
					});

				const release = updateDelivery("release").pipe(
					Effect.catch((error) => logSubscriberFailure(doc, error)),
				);
				return yield* Effect.gen(function* () {
					const { delivery } = claim;
					if (!delivery.emailPending && !delivery.pushPending) {
						return { ...emptyMonthlyRotationSummary(), assigned: input.assigned };
					}
					const verse = yield* fetchVerseCached(delivery.verseId, input.verseCache);
					const email = delivery.emailPending
						? sendMonthlyEmail(claim.subscriber, verse, delivery.monthLabel).pipe(
								Effect.andThen(updateDelivery("email")),
								Effect.as(1),
							)
						: Effect.succeed(0);
					const pushDelivery = delivery.pushPending
						? sendMonthlyPush(claim.subscriber, verse, delivery.monthLabel).pipe(
								Effect.tap((report) =>
									undeliveredPushCount(report) === 0 ? updateDelivery("push") : Effect.void,
								),
							)
						: Effect.succeed({ successCount: 0, failureCount: 0, prunedTokens: [] });
					// Commit acknowledgements independently so one failed channel does not replay the other.
					const [emailResult, pushResult] = yield* Effect.all(
						[Effect.result(email), Effect.result(pushDelivery)],
						{ concurrency: 2 },
					);
					if (emailResult._tag === "Failure") {
						yield* logSubscriberFailure(doc, emailResult.failure, input.assigned);
					}
					if (pushResult._tag === "Failure") {
						yield* logSubscriberFailure(doc, pushResult.failure, input.assigned);
					}
					const report = pushResult._tag === "Success" ? pushResult.success : undefined;
					const undelivered = report ? undeliveredPushCount(report) : 0;
					if (undelivered > 0) {
						yield* Effect.logWarning("Word of activation push delivery remains pending", {
							profileID: doc.id,
							failureCount: undelivered,
						});
					}
					return {
						...emptyMonthlyRotationSummary(),
						assigned: input.assigned,
						emailed: emailResult._tag === "Success" ? emailResult.success : 0,
						notified: report && report.successCount > 0 ? 1 : 0,
						failed:
							emailResult._tag === "Failure" || pushResult._tag === "Failure" || undelivered > 0
								? 1
								: 0,
					};
				}).pipe(
					Effect.timeout("2 minutes"),
					Effect.catchTag("TimeoutError", (cause) =>
						Effect.fail(new WordOfActivationRotationError({ operation: "deliveryTimeout", cause })),
					),
					Effect.catchTag("WordOfActivationRotationError", (error) =>
						logSubscriberFailure(doc, error, input.assigned),
					),
					Effect.ensuring(release),
				);
			},
		);

		const getExistingSubscription = Effect.fn("WordOfActivationService.getExistingSubscription")(
			function* (email: string) {
				const snapshot = yield* Effect.tryPromise({
					try: () =>
						firebase.secondaryDb
							.collection(firebase.AppCollections.wordActivationSub)
							.where("email", "==", email)
							.get(),
					catch: (cause) =>
						new WordOfActivationLookupError({
							operation: "findSubscriptionByEmail",
							cause,
						}),
				});

				if (snapshot.empty) {
					return null;
				}

				const subscriptionDoc = snapshot.docs[FIRST_INDEX];
				if (!subscriptionDoc) {
					return null;
				}

				const subscription = yield* Effect.try({
					try: () =>
						Schema.decodeUnknownSync(WordActivationSubSchema)({
							profileID: subscriptionDoc.id,
							...subscriptionDoc.data(),
						}),
					catch: (cause) =>
						new WordOfActivationLookupError({
							operation: "parseSubscription",
							cause,
						}),
				});

				const scriptureSnapshot = yield* Effect.tryPromise({
					try: () =>
						firebase.db
							.collection(firebase.AppCollections.wordActivationScriptures)
							.doc(subscription.wordActivationId)
							.get(),
					catch: (cause) =>
						new WordOfActivationLookupError({
							operation: "getScriptureById",
							cause,
						}),
				});

				if (!scriptureSnapshot.exists) {
					return null;
				}

				const verse = yield* Effect.try({
					try: () =>
						Schema.decodeUnknownSync(VerseDataSchema)({
							...scriptureSnapshot.data(),
							verseId: scriptureSnapshot.id,
						}),
					catch: (cause) =>
						new WordOfActivationLookupError({
							operation: "parseScripture",
							cause,
						}),
				});

				return toWordOfActivationData(subscription, verse);
			},
		);

		const subscribeNewUser = Effect.fn("WordOfActivationService.subscribeNewUser")(function* (
			email: string,
		) {
			const userSnapshot = yield* Effect.tryPromise({
				try: () =>
					firebase.db.collection(firebase.AppCollections.users).where("email", "==", email).get(),
				catch: (cause) =>
					new WordOfActivationLookupError({
						operation: "findUserByEmail",
						cause,
					}),
			});

			if (userSnapshot.empty) {
				return null;
			}

			const userData = (userSnapshot.docs[FIRST_INDEX]?.data() ?? {}) as UserProfileSnapshot;
			const displayName = `${userData.firstName ?? ""} ${userData.lastName ?? ""}`.trim() || email;

			const wordActivation = yield* getOrAssignWordOfActivationEffect({
				email,
				Name: displayName,
				sub: true,
			}).pipe(
				Effect.provideService(FirebaseAdminContext, firebase),
				Effect.mapError(
					(cause) =>
						new WordOfActivationLookupError({
							operation: "getWordOfTheMonth",
							cause,
						}),
				),
			);

			return toSubscribedWordOfActivation(email, displayName, wordActivation);
		});

		const getByEmail = Effect.fn("WordOfActivationService.getByEmail")(function* (email: string) {
			const existing = yield* getExistingSubscription(email);
			if (existing) {
				return existing;
			}

			return yield* subscribeNewUser(email);
		});

		const deliverSubscriber = (
			doc: SubscriberSnapshot,
			assignment: Result.Result<number, WordOfActivationRotationError>,
			input: { readonly currentMonthKey: string; readonly verseCache: Map<string, VerseData> },
		) =>
			assignment._tag === "Failure"
				? logSubscriberFailure(doc, assignment.failure)
				: handleSubscriber(doc, { ...input, assigned: assignment.success }).pipe(
						Effect.catchTag("WordOfActivationRotationError", (error) =>
							logSubscriberFailure(doc, error, assignment.success),
						),
					);

		const runMonthlyRotation = Effect.fn("WordOfActivationService.runMonthlyRotation")(
			function* () {
				const now = DateTime.toEpochMillis(DateTime.nowUnsafe());
				const currentMonthKey = formatInTimeZone(now, "America/New_York", "yyyy-MM");
				const monthLabel = formatInTimeZone(now, "America/New_York", "MMMM");
				const versePool = yield* loadVersePool;
				if (versePool.length === 0) {
					return yield* Effect.fail(
						new WordOfActivationRotationError({ operation: "emptyVersePool" }),
					);
				}

				const subscriberDocs = yield* loadSubscriberDocs;
				const delivery = { currentMonthKey, verseCache: new Map<string, VerseData>() };
				const assign = (doc: SubscriberSnapshot) =>
					assignMonthlyVerse(doc, { currentMonthKey, monthLabel, now, versePool }).pipe(
						Effect.result,
					);
				// Finish assignments for everyone before any notification work can wait or fail.
				const assignments = yield* Effect.forEach(
					subscriberDocs,
					(doc) => assign(doc).pipe(Effect.map((assignment) => ({ doc, assignment }))),
					{ concurrency: 10 },
				);
				const firstPass = yield* Effect.forEach(
					assignments,
					({ doc, assignment }) =>
						deliverSubscriber(doc, assignment, delivery).pipe(
							Effect.map((summary) => ({ doc, summary })),
						),
					{ concurrency: 10 },
				);
				const outcomes = yield* retryFailedOnce(firstPass, (doc) =>
					assign(doc).pipe(
						Effect.flatMap((assignment) => deliverSubscriber(doc, assignment, delivery)),
					),
				);

				const report = toReport(outcomes, currentMonthKey);
				yield* logReport("monthly rotation", report);
				return report;
			},
		);

		const sendPendingDeliveries = Effect.fn("WordOfActivationService.sendPendingDeliveries")(
			function* () {
				const now = DateTime.toEpochMillis(DateTime.nowUnsafe());
				const delivery = {
					currentMonthKey: formatInTimeZone(now, "America/New_York", "yyyy-MM"),
					verseCache: new Map<string, VerseData>(),
				};
				const subscriberDocs = yield* loadSubscriberDocs;
				// Assignment is the monthly run's job; only this month's pending channels are claimed.
				const deliver = (doc: SubscriberSnapshot) =>
					deliverSubscriber(doc, Result.succeed(0), delivery);
				const firstPass = yield* Effect.forEach(
					subscriberDocs,
					(doc) => deliver(doc).pipe(Effect.map((summary) => ({ doc, summary }))),
					{ concurrency: 10 },
				);

				const report = toReport(
					yield* retryFailedOnce(firstPass, deliver),
					delivery.currentMonthKey,
				);
				yield* logReport("pending delivery", report);
				return report;
			},
		);

		return {
			getByEmail,
			runMonthlyRotation: runMonthlyRotation(),
			sendPendingDeliveries: sendPendingDeliveries(),
			startMonthlyRotation: startInBackground(scope, "monthly rotation", runMonthlyRotation()),
			startPendingDeliveries: startInBackground(scope, "pending delivery", sendPendingDeliveries()),
		} satisfies WordOfActivationServiceContract;
	}),
}) {}

export const WordOfActivationServiceLive = Layer.effect(
	WordOfActivationService,
	WordOfActivationService.make,
);

export const getWordOfActivationByEmailEffect = (email: string) =>
	Effect.gen(function* () {
		const service = yield* WordOfActivationService;
		return yield* service.getByEmail(email);
	});
