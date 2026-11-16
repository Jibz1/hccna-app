import { FirebaseAdminContext } from "@/effect/FirebaseAdminContext";
import { ProfileService } from "@/effect/services/ProfileService";
import { OnboardingQueue, type OnboardingJob } from "@/services/onboarding/onboardingQueue";
import {
	buildOnboardingUserDoc,
	createFirestoreOnboardingDocEffect,
	enrichFirestoreOnboardingDocEffect,
	type OnboardingProfile,
	type UserDoc,
} from "@/services/onboarding/userProvisioning";
import { omitUndefined } from "@/utils/omitUndefined";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";

class OnboardingStoreError extends Schema.TaggedError<OnboardingStoreError>()(
	"OnboardingStoreError",
	{
		message: Schema.String,
		cause: Schema.Unknown,
	},
) {}

interface ProfileRow {
	firebase_uid: string;
	email: string;
	first_name: string | null;
	last_name: string | null;
	phone: string | null;
	img: string | null;
	is_verified: boolean;
	ccb_id: string | null;
	ccb_family_id: string | null;
	provider: string | null;
	created_at: Date;
	enrichment_pending: boolean;
	ccb_profile_checked_at: Date | null;
}

const rowToDoc = (row: ProfileRow): UserDoc =>
	omitUndefined({
		...buildOnboardingUserDoc(
			{
				uid: row.firebase_uid,
				email: row.email,
				firstName: row.first_name,
				lastName: row.last_name,
				phone: row.phone,
				img: row.img,
				isVerified: row.is_verified,
				provider: row.provider,
				createdAt: new Date(row.created_at).toISOString(),
			},
			null,
		),
		ccbId: row.ccb_id ?? undefined,
		ccbFamilyId: row.ccb_family_id ?? undefined,
		ccbEnrichmentPending: true,
	});

interface StoreAdapters {
	createFirestore: (doc: UserDoc) => Effect.Effect<void, unknown>;
	enrichFirestore: (job: OnboardingJob, profile: OnboardingProfile) => Effect.Effect<void, unknown>;
	clearCache: (input: { firebaseUid: string; email: string }) => Effect.Effect<void>;
}

export const makeOnboardingProfileStore = (adapters: StoreAdapters) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const queue = yield* OnboardingQueue;

		const ensure = Effect.fn("OnboardingProfileStore.ensure")(function* (doc: UserDoc) {
			// The queue can never observe a job without its base Postgres profile.
			// An enqueue failure rolls back the insert; a Firestore failure after
			// commit leaves a durable job that can finish creating the second store.
			const job = { version: 1 as const, uid: doc.uid, email: doc.email };
			const jobId = crypto.randomUUID();
			const row = yield* sql.withTransaction(
				Effect.gen(function* () {
					yield* sql`INSERT INTO app_users ${sql.insert({
						id: crypto.randomUUID(),
						firebase_uid: doc.uid,
						email: doc.email,
						first_name: doc.firstName ?? null,
						last_name: doc.lastName ?? null,
						phone: doc.phone ?? null,
						img: doc.img ?? null,
						is_verified: doc.isVerified,
						enrichment_pending: true,
						ccb_id: doc.ccbId ?? null,
						ccb_family_id: doc.ccbFamilyId ?? null,
						provider: doc.provider ?? null,
						created_at: doc.createdAt ?? new Date().toISOString(),
					})} ON CONFLICT (firebase_uid) DO NOTHING`;
					const rows =
						yield* sql<ProfileRow>`SELECT * FROM app_users WHERE firebase_uid = ${doc.uid} AND email = ${doc.email}`;
					if (!rows[0]) {
						return yield* new OnboardingStoreError({
							message: "Profile identity changed during provisioning",
							cause: doc.uid,
						});
					}
					yield* queue.offer(job, { id: jobId });
					return rows[0];
				}),
			);
			// The offer above woke the worker before COMMIT, while the job was still invisible
			// to its connection. Offering the same id again inserts nothing and wakes it now;
			// if this fails, the worker's next poll still finds the committed job.
			yield* queue.offer(job, { id: jobId }).pipe(Effect.ignore);
			yield* adapters.clearCache({ firebaseUid: doc.uid, email: doc.email });
			// Create-only prevents a foreground signup from overwriting enrichment
			// or edits made after the SQL transaction committed.
			const firestore = yield* Effect.result(
				adapters.createFirestore({ ...doc, ...rowToDoc(row) }),
			);
			if (firestore._tag === "Failure") {
				yield* Effect.logWarning("Base Firestore profile pending queue recovery", {
					uid: doc.uid,
					error: firestore.failure,
				});
			}
			return { postgresSuccess: true, firestoreSuccess: firestore._tag === "Success" };
		});

		const repair = Effect.fn("OnboardingProfileStore.repair")(function* (job: OnboardingJob) {
			const rows =
				yield* sql<ProfileRow>`SELECT * FROM app_users WHERE firebase_uid = ${job.uid} AND email = ${job.email}`;
			if (!rows[0]) {
				return null;
			}
			yield* adapters.createFirestore(rowToDoc(rows[0]));
			return {
				firstName: rows[0].first_name,
				lastName: rows[0].last_name,
				enrichmentPending: rows[0].enrichment_pending,
				ccbProfileCheckedAt: rows[0].ccb_profile_checked_at,
			};
		});

		const enrich = Effect.fn("OnboardingProfileStore.enrich")(function* (
			job: OnboardingJob,
			profile: OnboardingProfile,
		) {
			const rows = yield* sql<ProfileRow>`UPDATE app_users SET
			first_name = CASE WHEN first_name IS NULL OR first_name IN ('', 'Hi', 'There', 'Anonymous') THEN COALESCE(${profile.firstName ?? null}, first_name) ELSE first_name END,
			last_name = CASE WHEN last_name IS NULL OR last_name IN ('', 'Hi', 'There', 'Anonymous') THEN COALESCE(${profile.lastName ?? null}, last_name) ELSE last_name END,
			phone = COALESCE(NULLIF(phone, ''), ${profile.phone ?? null}),
			ccb_id = COALESCE(NULLIF(ccb_id, ''), ${profile.ccbId ?? null}),
			ccb_family_id = COALESCE(NULLIF(ccb_family_id, ''), ${profile.ccbFamilyId ?? null}),
			enrichment_pending = false,
			updated_at = CURRENT_TIMESTAMP
			WHERE firebase_uid = ${job.uid} AND email = ${job.email} RETURNING *`;
			const [row] = rows;
			// Never recreate a Postgres profile deleted while a job was queued.
			if (!row) {
				return;
			}
			yield* adapters.clearCache({ firebaseUid: job.uid, email: job.email });
			yield* adapters.enrichFirestore(
				job,
				omitUndefined({
					...profile,
					firstName: row.first_name ?? undefined,
					lastName: row.last_name ?? undefined,
					phone: row.phone ?? undefined,
					ccbId: row.ccb_id ?? undefined,
					ccbFamilyId: row.ccb_family_id ?? undefined,
				}),
			);
			// Record the completed check after both guarded writes return. A deleted or
			// changed Firestore identity is a terminal skip; failed reads/writes still retry.
			const checkedAt = new Date(yield* Clock.currentTimeMillis);
			yield* sql`UPDATE app_users SET ccb_profile_checked_at = ${checkedAt}
				WHERE firebase_uid = ${job.uid} AND email = ${job.email}`;
			yield* adapters.clearCache({ firebaseUid: job.uid, email: job.email });
		});

		// A skipped job cannot succeed on retry: the account is gone, or its email no longer
		// matches across stores. Record the check by uid alone, since the job's email is the
		// one that failed to match, so profile reads stop re-enqueueing it every hour.
		const markChecked = Effect.fn("OnboardingProfileStore.markChecked")(function* (
			job: OnboardingJob,
		) {
			const checkedAt = new Date(yield* Clock.currentTimeMillis);
			const rows = yield* sql<{ email: string }>`UPDATE app_users
				SET ccb_profile_checked_at = ${checkedAt}
				WHERE firebase_uid = ${job.uid} RETURNING email`;
			const [row] = rows;
			if (row) {
				yield* adapters.clearCache({ firebaseUid: job.uid, email: row.email });
			}
		});
		return { ensure, repair, enrich, markChecked };
	});

export class OnboardingProfileStore extends Context.Service<OnboardingProfileStore>()(
	"@hccnj/server/onboarding/OnboardingProfileStore",
	{
		make: Effect.gen(function* () {
			const firebase = yield* FirebaseAdminContext;
			const profiles = yield* ProfileService;
			return yield* makeOnboardingProfileStore({
				clearCache: (input) => profiles.clearCache(input),
				createFirestore: (doc) =>
					createFirestoreOnboardingDocEffect(doc).pipe(
						Effect.provideService(FirebaseAdminContext, firebase),
					),
				enrichFirestore: (job, profile) =>
					enrichFirestoreOnboardingDocEffect(job, profile).pipe(
						Effect.provideService(FirebaseAdminContext, firebase),
					),
			});
		}),
	},
) {}

export const OnboardingProfileStoreLive = Layer.effect(
	OnboardingProfileStore,
	OnboardingProfileStore.make,
);
