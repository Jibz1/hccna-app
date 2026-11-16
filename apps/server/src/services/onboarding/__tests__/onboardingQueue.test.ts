import { AppConfig } from "@/effect/AppConfig";
import { testAppConfig } from "@/effect/services/__tests__/fixtures";
import { makeOnboardingProfileStore } from "@/services/onboarding/onboardingProfileStore";
import {
	OnboardingJobSchema,
	type OnboardingJob,
	OnboardingQueue,
	OnboardingQueueLive,
	onboardingQueueStoreOptions,
} from "@/services/onboarding/onboardingQueue";
import {
	consumeOnboardingQueues,
	createOnboardingJobHandler,
} from "@/services/onboarding/onboardingWorker";
import {
	needsCcbProfileRefresh,
	type RefreshableProfile,
} from "@/services/onboarding/profileRefresh";
import { enrichmentPatch } from "@/services/onboarding/userProvisioning";
import { PgliteClient } from "@effect/sql-pglite";
import { describe, expect, it, mock } from "bun:test";
import { Deferred, Effect, Fiber, Layer, Option, Schedule, Schema, type Duration } from "effect";
import { PersistedQueue } from "effect/persistence";
import { SqlClient } from "effect/sql";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

class DirectoryUnavailableError extends Schema.TaggedError<DirectoryUnavailableError>()(
	"DirectoryUnavailableError",
	{ message: Schema.String },
) {}

// Fail with an error object, not a string: Cause.pretty renders a string failure
// through a fresh Error's stack, which Bun intermittently leaves undefined, so the
// stored last_failure would flake to "". Error objects always keep their message.
const failJob = () =>
	Effect.fail(new DirectoryUnavailableError({ message: "directory unavailable" }));

const input = { uid: "uid-1", email: "ada@example.com" };
const job: OnboardingJob = { version: 1, ...input };
const doc = { ...input, firstName: "Hi", lastName: "There", isVerified: true };
const directory = { email: input.email, firstName: "Ada", lastName: "Lovelace", ccbId: "42" };
const auth = {
	...input,
	emailVerified: true,
	displayName: "Ada Lovelace",
	providerData: [],
	metadata: {},
};

const testLayer = (dataDir?: string, pollInterval: Duration.Input = "10 millis") => {
	const sqlLayer = PgliteClient.layer(dataDir ? { dataDir } : {});
	const storeLayer = PersistedQueue.layerStoreSql({
		...onboardingQueueStoreOptions,
		pollInterval,
	}).pipe(Layer.provideMerge(sqlLayer));
	return Layer.effect(OnboardingQueue, OnboardingQueue.make).pipe(
		Layer.provideMerge(PersistedQueue.layer),
		Layer.provideMerge(storeLayer),
	);
};

const runWithDatabase = <A, E>(
	program: Effect.Effect<
		A,
		E,
		SqlClient.SqlClient | OnboardingQueue | PersistedQueue.PersistedQueueFactory
	>,
	dataDir?: string,
	pollInterval?: Duration.Input,
) => {
	const layer = testLayer(dataDir, pollInterval);
	return Effect.runPromise(program.pipe(Effect.provide(layer)));
};

const setup = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`CREATE TABLE IF NOT EXISTS app_users (
		id TEXT PRIMARY KEY, firebase_uid TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
		first_name TEXT, last_name TEXT, phone TEXT, img TEXT, is_verified BOOLEAN NOT NULL,
		ccb_id TEXT, ccb_family_id TEXT, provider TEXT, created_at TIMESTAMP NOT NULL,
		enrichment_pending BOOLEAN NOT NULL DEFAULT false,
		ccb_profile_checked_at TIMESTAMP WITH TIME ZONE,
		updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`;
	return sql;
});

const adapters = () => ({
	createFirestore: mock(() => Effect.void as Effect.Effect<void, unknown>),
	enrichFirestore: mock(() => Effect.void as Effect.Effect<void, unknown>),
	clearCache: mock(() => Effect.void),
});

it.each([undefined, ""])(
	"fails queue layer construction without a configured database (%s)",
	async (missing) => {
		const result = await Effect.runPromise(
			Layer.build(OnboardingQueueLive).pipe(
				Effect.scoped,
				Effect.provideService(AppConfig, {
					...testAppConfig,
					database: {
						...testAppConfig.database,
						connectionString: missing,
					},
				}),
				Effect.result,
			),
		);
		expect(result).toMatchObject({
			_tag: "Failure",
			failure: {
				_tag: "OnboardingDatabaseConfigError",
				message: "Onboarding queue requires DATABASE_URL",
			},
		});
	},
);

// The take timeout stays under the 30s poll, so only the offer's wake-up can pass it. The
// test timeout is long because this is the file's first PGlite boot, which took 23s on CI.
it("takes a job offered in this process without waiting for the production poll", async () => {
	const taken = await runWithDatabase(
		Effect.gen(function* () {
			const queue = yield* OnboardingQueue;
			const enqueueSoon = Effect.sleep("100 millis").pipe(Effect.andThen(queue.enqueue(input)));
			yield* Effect.forkChild(enqueueSoon);
			return yield* queue.take(Effect.succeed).pipe(Effect.timeout("20 seconds"));
		}),
		undefined,
		onboardingQueueStoreOptions.pollInterval,
	);
	expect(taken).toEqual(job);
}, 60_000);

describe("durable onboarding handoff", () => {
	// Postgres hides the job from the worker's own connection until COMMIT, so the
	// in-transaction offer's wake-up comes too early; the same id is offered again after.
	it("wakes the worker after the signup transaction commits, without a second job", async () => {
		await runWithDatabase(
			Effect.gen(function* () {
				const sql = yield* setup;
				const queue = yield* OnboardingQueue;
				const offers: { readonly id: string | undefined; readonly inTransaction: boolean }[] = [];
				const store = yield* makeOnboardingProfileStore(adapters()).pipe(
					Effect.provideService(OnboardingQueue, {
						...queue,
						offer: (value, options) =>
							Effect.gen(function* () {
								const transaction = yield* Effect.serviceOption(sql.transactionService);
								offers.push({ id: options?.id, inTransaction: Option.isSome(transaction) });
								return yield* queue.offer(value, options);
							}),
					}),
				);

				yield* store.ensure(doc);

				expect(offers.map(({ inTransaction }) => inTransaction)).toEqual([true, false]);
				expect(offers[0]?.id).toBeString();
				expect(offers[1]?.id).toBe(offers[0]?.id);
				expect(yield* sql`SELECT id FROM onboarding_queue`).toHaveLength(1);
			}),
		);
	}, 15_000);

	it("rolls back the profile when the queue insert fails", async () => {
		await runWithDatabase(
			Effect.gen(function* () {
				const sql = yield* setup;
				const queue = yield* OnboardingQueue;
				const writes = adapters();
				const store = yield* makeOnboardingProfileStore(writes).pipe(
					Effect.provideService(OnboardingQueue, {
						...queue,
						offer: () =>
							Effect.fail(new PersistedQueue.PersistedQueueError({ message: "queue unavailable" })),
					}),
				);
				expect((yield* Effect.result(store.ensure(doc)))._tag).toBe("Failure");
				expect(yield* sql`SELECT * FROM app_users`).toHaveLength(0);
				expect(writes.createFirestore).not.toHaveBeenCalled();
			}),
		);
	}, 15_000);

	it("recovers a partial signup after restart and retries a failed mirror write", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "onboarding-queue-"));
		try {
			await runWithDatabase(
				Effect.gen(function* () {
					const sql = yield* setup;
					const writes = adapters();
					writes.createFirestore.mockReturnValue(Effect.fail("Firestore unavailable"));
					const store = yield* makeOnboardingProfileStore(writes);
					expect(yield* store.ensure(doc)).toEqual({
						postgresSuccess: true,
						firestoreSuccess: false,
					});
					expect(yield* sql`SELECT enrichment_pending FROM app_users`).toEqual([
						{ enrichment_pending: true },
					]);
					expect(yield* sql`SELECT state FROM onboarding_queue`).toEqual([{ state: "pending" }]);
				}),
				dataDir,
			);

			await runWithDatabase(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient;
					const writes = adapters();
					writes.enrichFirestore.mockReturnValueOnce(Effect.fail("Firestore unavailable"));
					const store = yield* makeOnboardingProfileStore(writes);
					const queue = yield* PersistedQueue.make({
						name: "user-onboarding-v1",
						schema: OnboardingJobSchema,
						retrySchedule: Schedule.spaced("1 millis"),
					});
					expect(
						(yield* Effect.result(queue.take((value) => store.enrich(value, directory))))._tag,
					).toBe("Failure");
					expect(yield* sql`SELECT state, attempts FROM onboarding_queue`).toEqual([
						{ state: "pending", attempts: 1 },
					]);
					// Mobile reads Postgres: completion and enriched fields become visible
					// together even while the Firestore mirror still needs a retry.
					expect(yield* sql`SELECT first_name, enrichment_pending FROM app_users`).toEqual([
						{ first_name: "Ada", enrichment_pending: false },
					]);
					expect(yield* sql`SELECT ccb_profile_checked_at FROM app_users`).toEqual([
						{ ccb_profile_checked_at: null },
					]);
					yield* queue
						.take((value) => store.enrich(value, directory))
						.pipe(Effect.timeout("3 seconds"));
					expect(yield* sql`SELECT state, attempts FROM onboarding_queue`).toEqual([
						{ state: "completed", attempts: 2 },
					]);
					expect(yield* sql`SELECT first_name, ccb_id FROM app_users`).toEqual([
						{ first_name: "Ada", ccb_id: "42" },
					]);
					expect(writes.enrichFirestore).toHaveBeenCalledTimes(2);
					const [checked] = yield* sql<{ ccb_profile_checked_at: Date }>`
						SELECT ccb_profile_checked_at FROM app_users`;
					expect(checked?.ccb_profile_checked_at).toBeInstanceOf(Date);
				}),
				dataDir,
			);
		} finally {
			await rm(dataDir, { recursive: true, force: true });
		}
	}, 20_000);

	it("preserves concurrent edits, coalesces profile reads, and never recreates deleted rows", async () => {
		await runWithDatabase(
			Effect.gen(function* () {
				const sql = yield* setup;
				const writes = adapters();
				const store = yield* makeOnboardingProfileStore(writes);
				yield* store.ensure(doc);
				yield* sql`UPDATE app_users SET first_name = 'User', phone = '555', ccb_id = '99'`;
				yield* store.enrich(job, { ...directory, phone: "777" });
				expect(yield* sql`SELECT first_name, last_name, phone, ccb_id FROM app_users`).toEqual([
					{ first_name: "User", last_name: "Lovelace", phone: "555", ccb_id: "99" },
				]);
				const queue = yield* OnboardingQueue;
				yield* queue.enqueue(input);
				yield* queue.enqueue(input);
				expect(yield* sql`SELECT * FROM onboarding_queue`).toHaveLength(2);
				// An overlapping foreground retry must also keep the newer profile.
				yield* store.ensure(doc);
				expect(yield* sql`SELECT enrichment_pending FROM app_users`).toEqual([
					{ enrichment_pending: false },
				]);
				expect(writes.createFirestore).toHaveBeenLastCalledWith(
					expect.objectContaining({ firstName: "User", phone: "555", ccbId: "99" }),
				);
				yield* sql`DELETE FROM app_users`;
				writes.createFirestore.mockClear();
				yield* store.enrich(job, directory);
				expect(writes.createFirestore).not.toHaveBeenCalled();
				expect(yield* sql`SELECT * FROM app_users`).toHaveLength(0);
			}),
		);
	}, 15_000);

	it("waits six days after a successful directory miss, regardless of later profile edits", async () => {
		await runWithDatabase(
			Effect.gen(function* () {
				const sql = yield* setup;
				const store = yield* makeOnboardingProfileStore(adapters());
				yield* store.ensure({ ...doc, firstName: "Ada", lastName: "Example" });
				yield* store.enrich(job, { email: input.email });
				yield* sql`UPDATE app_users SET updated_at = CURRENT_TIMESTAMP`;
				const [row] = yield* sql<{ ccb_profile_checked_at: Date }>`
					SELECT ccb_profile_checked_at FROM app_users`;
				expect(row?.ccb_profile_checked_at).toBeInstanceOf(Date);
				const ccbProfileCheckedAt = row!.ccb_profile_checked_at;
				const profile = { firstName: "Ada", lastName: "Example", ccbProfileCheckedAt };
				const nextWeek = ccbProfileCheckedAt.getTime() + 6 * 24 * 60 * 60 * 1000;
				expect(needsCcbProfileRefresh(profile, nextWeek - 1)).toBe(false);
				expect(needsCcbProfileRefresh(profile, nextWeek)).toBe(true);
			}),
		);
	}, 15_000);

	it("records a skipped check by uid, so a drifted profile waits a day instead of looping", async () => {
		await runWithDatabase(
			Effect.gen(function* () {
				const sql = yield* setup;
				const writes = adapters();
				const store = yield* makeOnboardingProfileStore(writes);
				yield* store.ensure(doc);
				writes.clearCache.mockClear();
				// The worker skipped a job whose email no longer matches the account.
				yield* store.markChecked({ ...job, email: "old@example.com" });
				const [row] = yield* sql<{ ccb_profile_checked_at: Date; enrichment_pending: boolean }>`
					SELECT ccb_profile_checked_at, enrichment_pending FROM app_users`;
				expect(row?.ccb_profile_checked_at).toBeInstanceOf(Date);
				expect(writes.clearCache).toHaveBeenCalledWith({
					firebaseUid: input.uid,
					email: input.email,
				});
				const profile = {
					firstName: doc.firstName,
					lastName: doc.lastName,
					enrichmentPending: row!.enrichment_pending,
					ccbProfileCheckedAt: row!.ccb_profile_checked_at,
				};
				const checkedAt = row!.ccb_profile_checked_at.getTime();
				expect(profile.enrichmentPending).toBe(true);
				expect(needsCcbProfileRefresh(profile, checkedAt + 60 * 60 * 1000)).toBe(false);
				expect(needsCcbProfileRefresh(profile, checkedAt + 24 * 60 * 60 * 1000)).toBe(true);

				yield* sql`DELETE FROM app_users`;
				writes.clearCache.mockClear();
				yield* store.markChecked(job);
				expect(writes.clearCache).not.toHaveBeenCalled();
			}),
		);
	}, 15_000);

	it("coalesces signup and profile-read jobs before a second directory lookup", async () => {
		await runWithDatabase(
			Effect.gen(function* () {
				yield* setup;
				const store = yield* makeOnboardingProfileStore(adapters());
				const queue = yield* OnboardingQueue;
				yield* store.ensure(doc);
				yield* queue.enqueue(input);
				const getDirectoryProfile = mock(() => Effect.succeed(directory));
				const handler = createOnboardingJobHandler({
					getAuthUser: () => Effect.succeed(auth),
					loadFirestoreUser: () => Effect.succeed(doc),
					getDirectoryProfile,
					repair: store.repair,
					enrich: store.enrich,
					markChecked: store.markChecked,
				});
				const outcomes: string[] = [];
				const consume = queue.take((value) =>
					handler(value).pipe(Effect.tap((outcome) => Effect.sync(() => outcomes.push(outcome)))),
				);
				yield* consume;
				yield* consume;
				expect(outcomes).toEqual(["repaired", "already_checked"]);
				expect(getDirectoryProfile).toHaveBeenCalledTimes(1);
			}).pipe(Effect.timeout("10 seconds")),
		);
	}, 15_000);

	it("retains exhausted jobs for inspection instead of acknowledging errors", async () => {
		await runWithDatabase(
			Effect.gen(function* () {
				const sql = yield* setup;
				const queue = yield* PersistedQueue.make({
					name: "user-onboarding-v1",
					schema: OnboardingJobSchema,
					maxAttempts: 2,
					retrySchedule: Schedule.spaced("1 millis"),
				});
				yield* queue.offer(job);
				yield* Effect.result(queue.take(failJob));
				yield* Effect.result(queue.take(failJob).pipe(Effect.timeout("3 seconds")));
				const rows = yield* sql<{
					state: string;
					attempts: number;
					last_failure: string;
				}>`SELECT state, attempts, last_failure FROM onboarding_queue`;
				expect(rows[0]).toMatchObject({ state: "failed", attempts: 2 });
				expect(rows[0]?.last_failure).toContain("directory unavailable");
			}),
		);
	}, 15_000);
});

describe("routine refresh queue", () => {
	// On one FIFO queue the consumer would take the twenty older refreshes first, and the
	// stuck one would hold the signup behind it for good.
	it("takes a new signup while a backlog of routine refreshes is stuck", async () => {
		await runWithDatabase(
			Effect.gen(function* () {
				const sql = yield* setup;
				const queue = yield* OnboardingQueue;
				const store = yield* makeOnboardingProfileStore(adapters());
				for (let member = 0; member < 20; member++) {
					yield* queue.enqueueRefresh({
						uid: `uid-member-${member}`,
						email: `member${member}@example.com`,
					});
				}
				yield* store.ensure(doc);
				const refreshStarted = yield* Deferred.make<OnboardingJob>();
				const signup = yield* Deferred.make<OnboardingJob>();
				const consumers = yield* Effect.forkChild(
					consumeOnboardingQueues(queue, (value, _metadata, queueName) =>
						queueName === "refresh"
							? Deferred.succeed(refreshStarted, value).pipe(Effect.andThen(Effect.never))
							: Deferred.succeed(signup, value),
					),
				);
				expect((yield* Deferred.await(refreshStarted)).uid).toBe("uid-member-0");
				expect(yield* Deferred.await(signup)).toEqual(job);
				// The whole backlog is still waiting: one refresh in flight, nineteen untouched.
				const refreshes = yield* sql<{ attempts: number }>`
					SELECT attempts FROM onboarding_queue
					WHERE queue_name = 'ccb-profile-refresh-v1' AND state = 'pending'
					ORDER BY attempts`;
				expect(refreshes.map(({ attempts }) => Number(attempts))).toEqual([
					...Array.from({ length: 19 }, () => 0),
					1,
				]);
				yield* Fiber.interrupt(consumers);
			}).pipe(Effect.timeout("10 seconds")),
		);
	}, 15_000);

	it("keeps hourly ids per queue, so the worker's check stops the second lookup", async () => {
		await runWithDatabase(
			Effect.gen(function* () {
				const sql = yield* setup;
				const store = yield* makeOnboardingProfileStore(adapters());
				const queue = yield* OnboardingQueue;
				yield* store.ensure(doc);
				yield* queue.enqueueRefresh(input);
				yield* queue.enqueueRefresh(input);
				yield* queue.enqueue(input);
				const rows = yield* sql<{ id: string; queue_name: string }>`
					SELECT id, queue_name FROM onboarding_queue ORDER BY sequence`;
				expect(rows.map(({ queue_name }) => queue_name)).toEqual([
					"user-onboarding-v1",
					"ccb-profile-refresh-v1",
					"user-onboarding-v1",
				]);
				expect(rows[1]?.id).toBe(rows[2]!.id);
				const getDirectoryProfile = mock(() => Effect.succeed(directory));
				const handler = createOnboardingJobHandler({
					getAuthUser: () => Effect.succeed(auth),
					loadFirestoreUser: () => Effect.succeed(doc),
					getDirectoryProfile,
					repair: store.repair,
					enrich: store.enrich,
					markChecked: store.markChecked,
				});
				expect(yield* queue.take(handler)).toBe("repaired");
				expect(yield* queue.takeRefresh(handler)).toBe("already_checked");
				expect(yield* queue.take(handler)).toBe("already_checked");
				expect(getDirectoryProfile).toHaveBeenCalledTimes(1);
			}).pipe(Effect.timeout("10 seconds")),
		);
	}, 15_000);
});

describe("onboarding worker", () => {
	const dependencies = () => ({
		getAuthUser: mock(() => Effect.succeed(auth) as Effect.Effect<typeof auth | null, unknown>),
		getDirectoryProfile: mock(
			() => Effect.succeed(directory) as Effect.Effect<typeof directory | null, unknown>,
		),
		loadFirestoreUser: mock(
			() => Effect.succeed(doc) as Effect.Effect<typeof doc | undefined, unknown>,
		),
		repair: mock(
			() =>
				Effect.succeed({
					...doc,
					ccbProfileCheckedAt: null,
				}) as Effect.Effect<RefreshableProfile | null>,
		),
		enrich: mock(() => Effect.void as Effect.Effect<void, unknown>),
		markChecked: mock(() => Effect.void as Effect.Effect<void, unknown>),
	});

	it("distinguishes routine refreshes from repairs", async () => {
		const deps = dependencies();
		deps.repair.mockReturnValue(
			Effect.succeed({
				firstName: "Ada",
				lastName: "Example",
				ccbProfileCheckedAt: null,
			}),
		);
		deps.loadFirestoreUser.mockReturnValue(
			Effect.succeed({
				...doc,
				firstName: "Ada",
				lastName: "Example",
			}),
		);
		expect(await Effect.runPromise(createOnboardingJobHandler(deps)(job))).toBe("refreshed");
	});

	it("leaves lookup and write failures in the error channel for queue retries", async () => {
		const deps = dependencies();
		deps.getDirectoryProfile.mockReturnValueOnce(Effect.fail("CCB offline"));
		const handler = createOnboardingJobHandler(deps);
		const lookupFailure = await Effect.runPromise(Effect.result(handler(job)));
		expect(lookupFailure._tag).toBe("Failure");
		expect(deps.enrich).not.toHaveBeenCalled();
		expect(deps.repair).toHaveBeenCalledWith(job);
		deps.enrich.mockReturnValue(Effect.fail("partial write"));
		const writeFailure = await Effect.runPromise(Effect.result(handler(job)));
		expect(writeFailure._tag).toBe("Failure");
		expect(deps.markChecked).not.toHaveBeenCalled();
	});

	it("skips deleted and changed identities before looking up directory data", async () => {
		const deps = dependencies();
		const handler = createOnboardingJobHandler(deps);
		deps.getAuthUser.mockReturnValueOnce(Effect.succeed(null));
		expect(await Effect.runPromise(handler(job))).toBe("skipped");
		deps.getAuthUser.mockReturnValueOnce(Effect.succeed({ ...auth, email: "new@example.com" }));
		expect(await Effect.runPromise(handler(job))).toBe("skipped");
		expect(deps.getDirectoryProfile).not.toHaveBeenCalled();
		expect(deps.enrich).not.toHaveBeenCalled();
		expect(deps.markChecked).toHaveBeenCalledTimes(2);
		expect(deps.markChecked).toHaveBeenCalledWith(job);
	});

	it("records a check when the profile row no longer matches the job", async () => {
		const deps = dependencies();
		deps.repair.mockReturnValue(Effect.succeed(null));
		expect(await Effect.runPromise(createOnboardingJobHandler(deps)(job))).toBe("skipped");
		expect(deps.getDirectoryProfile).not.toHaveBeenCalled();
		expect(deps.markChecked).toHaveBeenCalledWith(job);
	});

	it("keeps a skipped job retryable when its check cannot be recorded", async () => {
		const deps = dependencies();
		deps.getAuthUser.mockReturnValue(Effect.succeed(null));
		deps.markChecked.mockReturnValue(Effect.fail("database unavailable"));
		const result = await Effect.runPromise(Effect.result(createOnboardingJobHandler(deps)(job)));
		expect(result._tag).toBe("Failure");
	});

	it("skips a mismatched Firestore email before attempting repair", async () => {
		const deps = dependencies();
		deps.loadFirestoreUser.mockReturnValue(Effect.succeed({ ...doc, email: "other@example.com" }));
		deps.repair.mockImplementation(() => Effect.die("Mismatched profiles must not be repaired"));
		expect(await Effect.runPromise(createOnboardingJobHandler(deps)(job))).toBe("skipped");
		expect(deps.repair).not.toHaveBeenCalled();
		expect(deps.getDirectoryProfile).not.toHaveBeenCalled();
		expect(deps.enrich).not.toHaveBeenCalled();
		expect(deps.markChecked).toHaveBeenCalledWith(job);
	});

	it.each([undefined, { ...doc, email: "" }])(
		"still repairs a missing profile or empty email (%j)",
		async (existingDoc) => {
			const deps = dependencies();
			deps.loadFirestoreUser.mockReturnValueOnce(Effect.succeed(existingDoc));
			expect(await Effect.runPromise(createOnboardingJobHandler(deps)(job))).toBe("repaired");
			expect(deps.repair).toHaveBeenCalledWith(job);
			expect(deps.enrich).toHaveBeenCalledWith(job, expect.objectContaining({ email: job.email }));
			expect(deps.markChecked).not.toHaveBeenCalled();
		},
	);

	it("skips enrichment when the Firestore email changes during directory lookup", async () => {
		const deps = dependencies();
		deps.getDirectoryProfile.mockImplementationOnce(() =>
			Effect.sync(() => {
				deps.loadFirestoreUser.mockReturnValue(
					Effect.succeed({ ...doc, email: "changed@example.com" }),
				);
				return directory;
			}),
		);
		expect(await Effect.runPromise(createOnboardingJobHandler(deps)(job))).toBe("skipped");
		expect(deps.repair).toHaveBeenCalledWith(job);
		expect(deps.loadFirestoreUser).toHaveBeenCalledTimes(2);
		expect(deps.enrich).not.toHaveBeenCalled();
		expect(deps.markChecked).toHaveBeenCalledWith(job);
	});

	it("uses auth names on a directory miss and preserves edits made during a lookup", async () => {
		const deps = dependencies();
		deps.getDirectoryProfile.mockReturnValue(Effect.succeed(null));
		deps.loadFirestoreUser.mockReturnValue(Effect.succeed({ ...doc, firstName: "Edited" }));
		expect(await Effect.runPromise(createOnboardingJobHandler(deps)(job))).toBe(
			"no_directory_match",
		);
		expect(deps.enrich).toHaveBeenCalledWith(job, {
			email: input.email,
			firstName: "Edited",
			lastName: "Lovelace",
		});
		expect(deps.markChecked).not.toHaveBeenCalled();
		expect(
			enrichmentPatch(
				{ ...doc, firstName: "Newer", phone: "555", ccbId: "99" },
				{ ...directory, phone: "777" },
			),
		).toEqual({ lastName: "Lovelace", ccbEnrichmentPending: false });
	});

	it("passes a match's empty group lists through, so enrichment clears groups the member left", async () => {
		const deps = dependencies();
		deps.getDirectoryProfile.mockReturnValue(
			Effect.succeed({ ...directory, departments: [], ministries: [] }),
		);
		expect(await Effect.runPromise(createOnboardingJobHandler(deps)(job))).toBe("repaired");
		expect(deps.enrich).toHaveBeenCalledWith(
			job,
			expect.objectContaining({ departments: [], ministries: [] }),
		);
		const group = { ccbId: "5", name: "Worship", fullName: "Worship", image: "", description: "" };
		const stored = {
			...doc,
			departments: [{ ...group, id: 1, slug: "worship", link: "https://example.com/worship" }],
			ministries: [{ ...group, id: 2, slug: "youth", link: "https://example.com/youth" }],
		};
		expect(
			enrichmentPatch(stored, { ...directory, departments: [], ministries: [] }),
		).toMatchObject({ departments: [], ministries: [] });
		expect(enrichmentPatch(stored, directory)).not.toHaveProperty("departments");
	});
});
