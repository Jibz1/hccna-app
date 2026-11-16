import { ProfileService } from "@/effect/services/ProfileService";
import { createDatabaseProfileLoaders } from "@/graphql/loaders/databaseProfileDataLoader";
import { OnboardingQueue } from "@/services/onboarding/onboardingQueue";
import { describe, expect, it, mock } from "bun:test";
import { Effect, Layer } from "effect";
import { PersistedQueue } from "effect/persistence";
import { TestClock } from "effect/testing";

import type { users } from "@/db/schema/users";
import type { EffectRunner } from "@/effect/DataLoaderFactory";

const now = Date.parse("2026-10-18T12:00:00Z");
const dayMs = 24 * 60 * 60 * 1000;
const refreshMs = 6 * dayMs;
const profile: typeof users.$inferSelect = {
	id: "profile-1",
	firebaseUid: "uid-1",
	email: "ada@example.com",
	firstName: "Ada",
	lastName: "Example",
	phone: "555-0100",
	img: null,
	isVerified: true,
	enrichmentPending: false,
	ccbProfileCheckedAt: new Date(now),
	ccbId: "42",
	ccbFamilyId: "7",
	provider: "apple.com",
	preferredCampusSlug: null,
	campusPreferenceVersion: 0,
	createdAt: new Date(now),
	updatedAt: new Date(now),
};

/** The refresh enqueue runs detached; the scheduler starts it on a later macrotask. */
const settle = async () => {
	for (let turn = 0; turn < 5; turn++) {
		await new Promise<void>((resolve) => {
			setImmediate(resolve);
		});
	}
};

const harness = (
	value: typeof profile | null,
	fromCache = false,
	currentUserUid: string | null = "uid-1",
) => {
	const enqueue = mock(() => Effect.void as Effect.Effect<void, unknown>);
	const enqueueRefresh = mock(() => Effect.void as Effect.Effect<void, unknown>);
	const lookupByFirebaseUid = mock(() => Effect.succeed({ profile: value, fromCache }));
	const layer = Layer.mergeAll(
		Layer.succeed(ProfileService, { lookupByFirebaseUid } as never),
		Layer.succeed(OnboardingQueue, { enqueue, enqueueRefresh } as never),
		TestClock.layer(),
	);
	const runPromise = (<A, E>(program: Effect.Effect<A, E, ProfileService | OnboardingQueue>) =>
		Effect.runPromise(
			TestClock.setTime(now).pipe(Effect.andThen(program), Effect.provide(layer)),
		)) as EffectRunner;
	return {
		...createDatabaseProfileLoaders(runPromise, currentUserUid),
		enqueue,
		enqueueRefresh,
		lookupByFirebaseUid,
	};
};

describe("CCB refresh on profile reads", () => {
	it.each([false, true])(
		"queues a legacy profile without a previous CCB check (cached: %s)",
		async (fromCache) => {
			const legacy = { ...profile, ccbProfileCheckedAt: null };
			const h = harness(legacy, fromCache);
			expect(await h.dbProfile.load("uid-1")).toEqual(legacy);
			await h.dbProfile.load("uid-1");
			await settle();
			expect(h.enqueueRefresh).toHaveBeenCalledTimes(1);
			expect(h.enqueueRefresh).toHaveBeenCalledWith({ uid: "uid-1", email: "ada@example.com" });
			// Routine checks of complete profiles stay off the signup queue.
			expect(h.enqueue).not.toHaveBeenCalled();
		},
	);

	it.each([
		{ age: refreshMs - 1, due: false },
		{ age: refreshMs, due: true },
		{ age: refreshMs + 1, due: true },
	])("checks again at six days ($age ms, due: $due)", async ({ age, due }) => {
		const h = harness({ ...profile, ccbProfileCheckedAt: new Date(now - age) });
		await h.dbProfile.load("uid-1");
		await settle();
		expect(h.enqueueRefresh).toHaveBeenCalledTimes(due ? 1 : 0);
	});

	it.each([{ enrichmentPending: true }, { firstName: "Anonymous" }])(
		"retries incomplete profiles on the signup queue a day after their last check (%j)",
		async (patch) => {
			const recent = harness({
				...profile,
				...patch,
				ccbProfileCheckedAt: new Date(now - dayMs + 1),
			});
			await recent.dbProfile.load("uid-1");
			await settle();
			expect(recent.enqueue).not.toHaveBeenCalled();
			const due = harness({ ...profile, ...patch, ccbProfileCheckedAt: new Date(now - dayMs) });
			await due.dbProfile.load("uid-1");
			await settle();
			expect(due.enqueue).toHaveBeenCalledTimes(1);
			expect(due.enqueueRefresh).not.toHaveBeenCalled();
		},
	);

	it("returns the stored profile when scheduling fails and retries on the next request", async () => {
		const h = harness({ ...profile, ccbProfileCheckedAt: null });
		h.enqueueRefresh.mockReturnValueOnce(
			Effect.fail(new PersistedQueue.PersistedQueueError({ message: "queue unavailable" })),
		);
		expect(await h.dbProfile.load("uid-1")).toMatchObject({ firstName: "Ada" });
		await settle();
		h.dbProfile.clear("uid-1");
		expect(await h.dbProfile.load("uid-1")).toMatchObject({ firstName: "Ada" });
		await settle();
		expect(h.enqueueRefresh).toHaveBeenCalledTimes(2);
	});

	it.each([null, "another-uid"])(
		"does not refresh profiles for a different caller (%s)",
		async (uid) => {
			const h = harness({ ...profile, ccbProfileCheckedAt: null }, false, uid);
			expect(await h.dbProfile.load("uid-1")).toMatchObject({ firstName: "Ada" });
			await settle();
			expect(h.enqueue).not.toHaveBeenCalled();
			expect(h.enqueueRefresh).not.toHaveBeenCalled();
		},
	);

	it("returns a profile while the enqueue is still waiting", async () => {
		const h = harness({ ...profile, ccbProfileCheckedAt: null });
		const pending = Promise.withResolvers<void>();
		const completed = Promise.withResolvers<void>();
		h.enqueueRefresh.mockReturnValue(
			Effect.promise(() => pending.promise).pipe(
				Effect.tap(() => Effect.sync(() => completed.resolve())),
			),
		);
		try {
			expect(await h.dbProfile.load("uid-1")).toMatchObject({ firstName: "Ada" });
			await settle();
			expect(h.enqueueRefresh).toHaveBeenCalledTimes(1);
		} finally {
			pending.resolve();
			await completed.promise;
		}
	});

	it("leaves missing-profile provisioning to the resolver", async () => {
		const h = harness(null);
		expect(await h.dbProfile.load("uid-1")).toBeNull();
		await settle();
		expect(h.enqueue).not.toHaveBeenCalled();
		expect(h.enqueueRefresh).not.toHaveBeenCalled();
	});
});
