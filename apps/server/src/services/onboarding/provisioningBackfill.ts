import { FirebaseAuthService } from "@/effect/services/FirebaseAuthService";
import {
	type EnsureUserProfileError,
	type EnsureUserProfileInput,
	type EnsureUserProfileSuccess,
	ensureUserProfileEffect,
} from "@/services/onboarding/ensureUserProfile";
import { OnboardingQueue } from "@/services/onboarding/onboardingQueue";
import {
	listFirestoreUsersEffect,
	listPostgresUsersEffect,
} from "@/services/onboarding/userProvisioning";
import { omitUndefined } from "@/utils/omitUndefined";
import { Predicate, Effect } from "effect";

/*
  Phase-3 reconciliation tooling (safe-user-provisioning rollout): a read-only
  audit of Firebase Auth vs Firestore vs Postgres, and a backfill that repairs
  what the audit found through the same reconciliation core the
  ensureUserProfile mutation uses. Conflicts are always quarantined for manual
  review; creation for auth users missing every record is opt-in because an
  interrupted account deletion leaves the same shape.
*/

export interface AuditAuthUser {
	readonly uid: string;
	readonly email?: string | null;
	readonly creationTime?: string;
	readonly lastSignInTime?: string;
}

export interface AuditFirestoreUser {
	readonly uid: string;
	readonly email?: string | null;
	readonly ccbEnrichmentPending?: boolean;
}

export interface AuditPostgresUser {
	readonly firebaseUid: string;
	readonly email: string;
}

type ProvisioningCategory = "complete" | "firestore-only" | "postgres-only" | "missing-both";

export interface AuditedAuthUser {
	readonly uid: string;
	readonly email: string | null;
	readonly category: ProvisioningCategory;
	readonly enrichmentPending: boolean;
	readonly conflicted: boolean;
	/** True when this uid's own email differs across Auth/Firestore/Postgres. */
	readonly emailDrift: boolean;
	readonly creationTime?: string;
	readonly lastSignInTime?: string;
}

interface OrphanedRecord {
	readonly uid: string;
	readonly email: string | null;
}

interface EmailConflict {
	readonly email: string;
	readonly uids: readonly string[];
}

interface ProvisioningAuditCounts {
	readonly authUsers: number;
	readonly complete: number;
	readonly firestoreOnly: number;
	readonly postgresOnly: number;
	readonly missingBoth: number;
	readonly conflicts: number;
	readonly emailDrift: number;
	readonly enrichmentPending: number;
	readonly orphanedFirestore: number;
	readonly orphanedPostgres: number;
}

export interface ProvisioningAudit {
	readonly users: readonly AuditedAuthUser[];
	readonly orphanedFirestore: readonly OrphanedRecord[];
	readonly orphanedPostgres: readonly OrphanedRecord[];
	readonly conflicts: readonly EmailConflict[];
	readonly counts: ProvisioningAuditCounts;
}

const normalizeEmail = (email: string | null | undefined): string | null => {
	const trimmed = email?.trim().toLowerCase();
	return trimmed || null;
};

export function classifyProvisioningState(input: {
	readonly authUsers: readonly AuditAuthUser[];
	readonly firestoreUsers: readonly AuditFirestoreUser[];
	readonly postgresUsers: readonly AuditPostgresUser[];
}): ProvisioningAudit {
	const firestoreByUid = new Map(input.firestoreUsers.map((user) => [user.uid, user]));
	const postgresByUid = new Map(input.postgresUsers.map((user) => [user.firebaseUid, user]));
	const authUids = new Set(input.authUsers.map((user) => user.uid));

	// The stores drift, so email ownership is checked across every source: an
	// email mapping to more than one uid anywhere is a conflict to review, and
	// a uid carrying different emails across sources is drift to review.
	const emailOwners = new Map<string, Set<string>>();
	const emailsByUid = new Map<string, Set<string>>();
	const recordOwner = (email: string | null | undefined, uid: string) => {
		const normalized = normalizeEmail(email);
		if (!normalized) {
			return;
		}
		const owners = emailOwners.get(normalized) ?? new Set<string>();
		owners.add(uid);
		emailOwners.set(normalized, owners);
		const emails = emailsByUid.get(uid) ?? new Set<string>();
		emails.add(normalized);
		emailsByUid.set(uid, emails);
	};
	for (const user of input.authUsers) {
		recordOwner(user.email, user.uid);
	}
	for (const user of input.firestoreUsers) {
		recordOwner(user.email, user.uid);
	}
	for (const user of input.postgresUsers) {
		recordOwner(user.email, user.firebaseUid);
	}

	const conflicts: EmailConflict[] = [];
	const conflictedUids = new Set<string>();
	for (const [email, owners] of emailOwners) {
		if (owners.size > 1) {
			conflicts.push({ email, uids: [...owners] });
			for (const uid of owners) {
				conflictedUids.add(uid);
			}
		}
	}

	const users = input.authUsers.map((user): AuditedAuthUser => {
		const firestoreDoc = firestoreByUid.get(user.uid);
		const postgresRow = postgresByUid.get(user.uid);
		let category: ProvisioningCategory = "missing-both";
		if (firestoreDoc && postgresRow) {
			category = "complete";
		} else if (firestoreDoc) {
			category = "firestore-only";
		} else if (postgresRow) {
			category = "postgres-only";
		}

		return omitUndefined({
			uid: user.uid,
			email: user.email ?? null,
			category,
			enrichmentPending: firestoreDoc?.ccbEnrichmentPending === true,
			conflicted: conflictedUids.has(user.uid),
			emailDrift: (emailsByUid.get(user.uid)?.size ?? 0) > 1,
			creationTime: user.creationTime || undefined,
			lastSignInTime: user.lastSignInTime || undefined,
		});
	});

	const orphanedFirestore = input.firestoreUsers
		.filter((user) => !authUids.has(user.uid))
		.map((user): OrphanedRecord => ({ uid: user.uid, email: user.email ?? null }));
	const orphanedPostgres = input.postgresUsers
		.filter((user) => !authUids.has(user.firebaseUid))
		.map((user): OrphanedRecord => ({ uid: user.firebaseUid, email: user.email }));

	const countBy = (category: ProvisioningCategory) =>
		users.filter((user) => user.category === category).length;

	return {
		users,
		orphanedFirestore,
		orphanedPostgres,
		conflicts,
		counts: {
			authUsers: users.length,
			complete: countBy("complete"),
			firestoreOnly: countBy("firestore-only"),
			postgresOnly: countBy("postgres-only"),
			missingBoth: countBy("missing-both"),
			conflicts: conflicts.length,
			emailDrift: users.filter((user) => user.emailDrift).length,
			enrichmentPending: users.filter((user) => user.enrichmentPending).length,
			orphanedFirestore: orphanedFirestore.length,
			orphanedPostgres: orphanedPostgres.length,
		},
	};
}

type BackfillSkipReason =
	| "already-complete"
	| "already-processed"
	| "email-drift"
	| "identity-conflict"
	| "missing-email"
	| "requires-create-missing";

export type BackfillPlan =
	| {
			readonly action: "repair" | "create" | "enrich";
			readonly uid: string;
			readonly email: string;
	  }
	| {
			readonly action: "skip";
			readonly uid: string;
			readonly email: string | null;
			readonly reason: BackfillSkipReason;
	  };

export interface BackfillOptions {
	readonly createMissing: boolean;
	readonly completedUids?: ReadonlySet<string>;
}

export function planBackfillAction(user: AuditedAuthUser, options: BackfillOptions): BackfillPlan {
	const skip = (reason: BackfillSkipReason): BackfillPlan => ({
		action: "skip",
		uid: user.uid,
		email: user.email,
		reason,
	});

	if (options.completedUids?.has(user.uid)) {
		return skip("already-processed");
	}
	if (user.conflicted) {
		return skip("identity-conflict");
	}
	if (user.emailDrift) {
		// Which email is current is a human call; writing either could clobber
		// the right one, so drifted users are quarantined like conflicts.
		return skip("email-drift");
	}
	if (user.email === null) {
		return skip("missing-email");
	}
	if (user.category === "complete") {
		return user.enrichmentPending
			? { action: "enrich", uid: user.uid, email: user.email }
			: skip("already-complete");
	}
	if (user.category === "missing-both") {
		return options.createMissing
			? { action: "create", uid: user.uid, email: user.email }
			: skip("requires-create-missing");
	}
	return { action: "repair", uid: user.uid, email: user.email };
}

interface RetryEnrichmentResult {
	readonly queued: boolean;
}

export interface BackfillOutcome {
	readonly uid: string;
	readonly email: string | null;
	readonly action: "repair" | "create" | "enrich" | "skip";
	readonly status: "success" | "failed" | "skipped";
	readonly reason?: string;
	readonly created?: boolean;
	readonly repaired?: boolean;
	readonly enrichmentPending?: boolean;
	readonly queued?: boolean;
}

export interface BackfillRunOptions extends BackfillOptions {
	readonly concurrency?: number;
	readonly onOutcome?: (outcome: BackfillOutcome) => Effect.Effect<void>;
}

export interface BackfillDeps<R1, R2> {
	ensureUserProfile: (
		input: EnsureUserProfileInput,
	) => Effect.Effect<EnsureUserProfileSuccess, EnsureUserProfileError | unknown, R1>;
	retryEnrichment: (
		input: EnsureUserProfileInput,
	) => Effect.Effect<RetryEnrichmentResult, unknown, R2>;
}

const describeFailure = (cause: unknown): string => {
	if (cause instanceof Error) {
		return cause.message;
	}
	if (
		Predicate.isObject(cause) &&
		cause !== null &&
		"message" in cause &&
		Predicate.isString(cause.message)
	) {
		return cause.message;
	}
	return String(cause);
};

/**
 * Execute the planned backfill action for every audited user. Never fails as
 * a whole: each user resolves to an outcome record so a run over thousands of
 * users survives individual failures and the log doubles as the resume state.
 */
const createBackfillEffect =
	<R1, R2>(deps: BackfillDeps<R1, R2>) =>
	(
		users: readonly AuditedAuthUser[],
		options: BackfillRunOptions,
	): Effect.Effect<BackfillOutcome[], never, R1 | R2> => {
		const execute = (user: AuditedAuthUser): Effect.Effect<BackfillOutcome, never, R1 | R2> =>
			Effect.gen(function* () {
				const plan = planBackfillAction(user, options);
				if (plan.action === "skip") {
					return {
						uid: plan.uid,
						email: plan.email,
						action: "skip" as const,
						status: "skipped" as const,
						reason: plan.reason,
					};
				}

				const target = { uid: plan.uid, email: plan.email };
				if (plan.action === "enrich") {
					const result = yield* Effect.result(deps.retryEnrichment(target));
					return result._tag === "Failure"
						? {
								...target,
								action: "enrich" as const,
								status: "failed" as const,
								reason: describeFailure(result.failure),
							}
						: {
								...target,
								action: "enrich" as const,
								status: "success" as const,
								queued: result.success.queued,
							};
				}

				const result = yield* Effect.result(deps.ensureUserProfile(target));
				return result._tag === "Failure"
					? {
							...target,
							action: plan.action,
							status: "failed" as const,
							reason: describeFailure(result.failure),
						}
					: {
							...target,
							action: plan.action,
							status: "success" as const,
							created: result.success.created,
							repaired: result.success.repaired,
							enrichmentPending: result.success.enrichmentPending,
						};
			});

		// The callback is observability, not control flow: contain failures AND
		// defects so a logging hiccup can never abort the in-flight batch.
		const executeAndLog = (user: AuditedAuthUser) =>
			execute(user).pipe(
				Effect.tap((outcome) =>
					(options.onOutcome?.(outcome) ?? Effect.void).pipe(
						Effect.catchCause((cause) =>
							Effect.logWarning("backfill outcome callback failed").pipe(
								Effect.annotateLogs({ uid: outcome.uid, cause: String(cause) }),
							),
						),
					),
				),
			);

		return Effect.forEach(users, executeAndLog, {
			concurrency: options.concurrency ?? 5,
		});
	};

/** Read-only production audit: list all three sources and classify. */
export const auditProvisioningStateEffect = Effect.gen(function* () {
	const auth = yield* FirebaseAuthService;
	const [authUsers, firestoreUsers, postgresUsers] = yield* Effect.all(
		[auth.listAllUsers(), listFirestoreUsersEffect, listPostgresUsersEffect],
		{ concurrency: 3 },
	);
	return classifyProvisioningState({
		authUsers: authUsers.map((user) =>
			omitUndefined({
				uid: user.uid,
				email: user.email ?? null,
				creationTime: user.metadata.creationTime || undefined,
				lastSignInTime: user.metadata.lastSignInTime || undefined,
			}),
		),
		firestoreUsers,
		postgresUsers,
	});
});

/** Explicit backfills offer a fresh job, including after exhausted retries. */
const retryEnrichmentEffect = Effect.fn("ProvisioningBackfill.enqueueEnrichment")(function* (
	input: EnsureUserProfileInput,
) {
	const queue = yield* OnboardingQueue;
	yield* queue.offer({ version: 1, ...input });
	return { queued: true };
});

/** Production backfill: audit output in, per-user outcomes out. */
export const runProvisioningBackfillEffect = (
	users: readonly AuditedAuthUser[],
	options: BackfillRunOptions,
) =>
	createBackfillEffect({
		ensureUserProfile: ensureUserProfileEffect,
		retryEnrichment: retryEnrichmentEffect,
	})(users, options);
