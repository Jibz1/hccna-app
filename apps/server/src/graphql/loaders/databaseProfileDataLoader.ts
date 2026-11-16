import { createDataLoaderFactory, type EffectRunner } from "@/effect/DataLoaderFactory";
import { CampusPreferenceStore } from "@/effect/services/CampusPreferenceStore";
import { ProfileService } from "@/effect/services/ProfileService";
import { OnboardingQueue } from "@/services/onboarding/onboardingQueue";
import { isIncompleteProfile, needsCcbProfileRefresh } from "@/services/onboarding/profileRefresh";
import { Clock, Effect } from "effect";

interface CampusPreference {
	preferredCampusSlug: string | null;
	campusPreferenceVersion: number;
}

export function createDatabaseProfileLoaders(
	runPromise: EffectRunner,
	currentUserUid?: string | null,
) {
	const factory = createDataLoaderFactory(runPromise);
	const campusPreference = factory.make({
		name: "CampusPreferenceDataLoader",
		batchLoad: (uids: readonly string[]) =>
			Effect.gen(function* () {
				const store = yield* CampusPreferenceStore;
				return yield* Effect.forEach(uids, (uid) =>
					store.get(uid).pipe(Effect.map((preference): CampusPreference => preference)),
				);
			}),
	});
	const dbProfile = factory.make({
		name: "DatabaseProfileDataLoader",
		batchLoad: (uids: readonly string[]) =>
			Effect.gen(function* () {
				const service = yield* ProfileService;
				return yield* Effect.forEach(
					uids,
					Effect.fnUntraced(function* (uid) {
						const { profile, fromCache } = yield* service.lookupByFirebaseUid(uid);
						// Only a database read is authoritative across server instances.
						// Cached profiles must leave the campus fields to the fresh loader.
						if (profile && !fromCache) {
							campusPreference.prime(uid, profile);
						}
						// Loading another member's profile must not count as that member opening the app.
						if (
							uid === currentUserUid &&
							profile &&
							needsCcbProfileRefresh(profile, yield* Clock.currentTimeMillis)
						) {
							yield* Effect.gen(function* () {
								const queue = yield* OnboardingQueue;
								// Repairs share the signup queue; routine checks drain on their own.
								const enqueue = isIncompleteProfile(profile) ? queue.enqueue : queue.enqueueRefresh;
								yield* enqueue({ uid, email: profile.email });
							}).pipe(
								Effect.timeout("5 seconds"),
								Effect.catch((error) =>
									Effect.logWarning("Failed to enqueue CCB profile refresh", { uid, error }),
								),
								Effect.forkDetach,
							);
						}
						return profile;
					}),
				);
			}),
	});
	return { dbProfile, campusPreference };
}
