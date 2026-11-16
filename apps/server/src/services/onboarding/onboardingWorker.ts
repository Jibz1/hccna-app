import { AppConfig } from "@/effect/AppConfig";
import { FirebaseAuthService } from "@/effect/services/FirebaseAuthService";
import { StatsigService } from "@/effect/StatsigService";
import {
	toOnboardingPayload,
	type FirebaseUserProfile,
} from "@/services/onboarding/ensureUserProfile";
import { OnboardingProfileStore } from "@/services/onboarding/onboardingProfileStore";
import { OnboardingQueue, type OnboardingJob } from "@/services/onboarding/onboardingQueue";
import {
	hasPlaceholderName,
	isIncompleteProfile,
	needsCcbProfileRefresh,
	type RefreshableProfile,
} from "@/services/onboarding/profileRefresh";
import {
	FALLBACK_NAMES,
	getOnboardingProfileEffect,
	getUserByIdEffect,
	type OnboardingProfile,
	type StoredUserDoc,
} from "@/services/onboarding/userProvisioning";
import { buildStatsigUser } from "@/statsig/user";
import { omitUndefined } from "@/utils/omitUndefined";
import { Cause, Clock, Effect, Schedule } from "effect";

interface JobDependencies<R1, R2, R3, R4> {
	getAuthUser: (
		uid: string,
	) => Effect.Effect<
		(FirebaseUserProfile & { email?: string; disabled?: boolean }) | null,
		unknown,
		R1
	>;
	getDirectoryProfile: (email: string) => Effect.Effect<OnboardingProfile | null, unknown, R2>;
	loadFirestoreUser: (uid: string) => Effect.Effect<StoredUserDoc | undefined, unknown, R3>;
	repair: (job: OnboardingJob) => Effect.Effect<RefreshableProfile | null, unknown, R4>;
	enrich: (job: OnboardingJob, profile: OnboardingProfile) => Effect.Effect<void, unknown, R4>;
	markChecked: (job: OnboardingJob) => Effect.Effect<void, unknown, R4>;
}

const currentName = (value: string | null | undefined) =>
	value && !FALLBACK_NAMES.has(value) ? value : undefined;

export const createOnboardingJobHandler = <R1, R2, R3, R4>(
	deps: JobDependencies<R1, R2, R3, R4>,
) => {
	const process = Effect.fnUntraced(function* (job: OnboardingJob) {
		const auth = yield* deps.getAuthUser(job.uid);
		// A queued job must not revive a deleted account or use an old email to
		// attach somebody else's directory identity after an account change.
		if (!auth || auth.disabled || auth.email !== job.email) {
			return "skipped" as const;
		}
		const existingDoc = yield* deps.loadFirestoreUser(job.uid);
		if (existingDoc?.email && existingDoc.email !== job.email) {
			return "skipped" as const;
		}
		// Repair the base profile even when the optional directory is unavailable.
		const stored = yield* deps.repair(job);
		if (!stored) {
			return "skipped" as const;
		}
		const incomplete =
			isIncompleteProfile(stored) ||
			existingDoc?.ccbEnrichmentPending === true ||
			hasPlaceholderName(existingDoc ?? {});
		// Duplicate jobs and reads from stale caches must not repeat a completed lookup.
		if (!needsCcbProfileRefresh(stored, yield* Clock.currentTimeMillis, incomplete)) {
			return "already_checked" as const;
		}
		const profile = yield* deps.getDirectoryProfile(job.email);
		const doc = yield* deps.loadFirestoreUser(job.uid);
		if (doc?.email && doc.email !== job.email) {
			return "skipped" as const;
		}
		const authProfile = toOnboardingPayload(auth, job.email);
		yield* deps.enrich(
			job,
			omitUndefined({
				...profile,
				email: job.email,
				firstName:
					currentName(doc?.firstName) ?? profile?.firstName ?? authProfile.firstName ?? undefined,
				lastName:
					currentName(doc?.lastName) ?? profile?.lastName ?? authProfile.lastName ?? undefined,
				phone: doc?.phone || profile?.phone,
				ccbId: doc?.ccbId || profile?.ccbId,
				ccbFamilyId: doc?.ccbFamilyId || profile?.ccbFamilyId,
			}),
		);
		if (!profile?.ccbId) {
			return "no_directory_match" as const;
		}
		return incomplete ? ("repaired" as const) : ("refreshed" as const);
	});

	return Effect.fn("OnboardingWorker.process")(function* (job: OnboardingJob) {
		const outcome = yield* process(job);
		if (outcome === "skipped") {
			yield* deps.markChecked(job);
		}
		return outcome;
	});
};

type QueueName = "onboarding" | "refresh";

/**
 * One consumer per queue, so a backlog of routine refreshes drains beside signups and
 * repairs instead of in front of them. Each consumer runs one job at a time.
 */
export const consumeOnboardingQueues = <E, R>(
	queue: Pick<OnboardingQueue["Service"], "take" | "takeRefresh">,
	handle: (
		job: OnboardingJob,
		metadata: { readonly id: string; readonly attempts: number },
		queueName: QueueName,
	) => Effect.Effect<unknown, E, R>,
) => {
	const consume = (take: OnboardingQueue["Service"]["take"], queueName: QueueName) =>
		take((job, metadata) => handle(job, metadata, queueName)).pipe(
			// Catch outside take: the failed handler must reach the queue's finalizer
			// so it records the attempt and schedules the next delivery.
			Effect.catchCause((cause) =>
				Cause.hasInterruptsOnly(cause)
					? Effect.failCause(cause)
					: Effect.logWarning("Onboarding consumer retrying", { queue: queueName, cause }).pipe(
							Effect.andThen(Effect.sleep("1 second")),
						),
			),
			Effect.forever,
		);
	return Effect.all([consume(queue.take, "onboarding"), consume(queue.takeRefresh, "refresh")], {
		concurrency: "unbounded",
		discard: true,
	});
};

/** Started only by Main, so audit scripts and schema tooling never consume jobs. */
export const runOnboardingWorker = Effect.gen(function* () {
	const queue = yield* OnboardingQueue;
	const store = yield* OnboardingProfileStore;
	const auth = yield* FirebaseAuthService;
	const statsig = yield* StatsigService;
	const config = yield* AppConfig;
	const process = createOnboardingJobHandler({
		getAuthUser: (uid) =>
			auth.getUser(uid).pipe(
				Effect.catchTag("FirebaseAuthError", (error) =>
					error.code === "auth/user-not-found" ? Effect.succeed(null) : Effect.fail(error),
				),
				Effect.timeout("5 seconds"),
			),
		getDirectoryProfile: (email) =>
			getOnboardingProfileEffect(email).pipe(Effect.timeout("8 seconds")),
		loadFirestoreUser: getUserByIdEffect,
		repair: store.repair,
		enrich: store.enrich,
		markChecked: store.markChecked,
	});

	yield* queue.cleanup.pipe(
		Effect.catch((error) => Effect.logWarning("Onboarding queue cleanup failed", { error })),
		Effect.repeat(Schedule.spaced("1 day")),
		Effect.forkScoped,
	);

	return yield* consumeOnboardingQueues(queue, (job, metadata, queueName) =>
		process(job).pipe(
			Effect.timeout("30 seconds"),
			Effect.tap((outcome) =>
				Effect.sync(() =>
					statsig.logEvent(
						buildStatsigUser({
							currentUserUid: job.uid,
							currentUserEmail: job.email,
							environment: config.statsig.environment ?? config.nodeEnv,
						}),
						"ccb_profile_enrichment",
						outcome,
						{ outcome, queue: queueName },
					),
				).pipe(Effect.catchCause(() => Effect.void)),
			),
			Effect.tapError((error) =>
				Effect.logWarning("Onboarding job failed", {
					queue: queueName,
					jobId: metadata.id,
					uid: job.uid,
					attempt: metadata.attempts,
					error,
				}),
			),
		),
	);
});
