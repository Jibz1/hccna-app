import { campusSubscriptionSync, users } from "@/db/schema/users";
import {
	CampusPreferenceError,
	InvalidCampusPreferenceError,
	preferenceChange,
	SetCampusPreferenceSchema,
	type SetCampusPreferenceInput,
} from "@/effect/services/campus/preference";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { and, eq, lte, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

const selection = {
	userId: users.id,
	firebaseUid: users.firebaseUid,
	email: users.email,
	preferredCampusSlug: users.preferredCampusSlug,
	campusPreferenceVersion: users.campusPreferenceVersion,
};

const make = Effect.gen(function* () {
	const { db } = yield* DrizzleService;
	const get = Effect.fn("CampusPreferenceStore.get")(function* (firebaseUid: string) {
		const [profile] = yield* Effect.tryPromise({
			try: () => db.select(selection).from(users).where(eq(users.firebaseUid, firebaseUid)),
			catch: (cause) =>
				new CampusPreferenceError({ detail: "Unable to read campus preference", cause }),
		});
		if (!profile) {
			return yield* new CampusPreferenceError({ detail: "User profile is unavailable" });
		}
		return profile;
	});
	const set = Effect.fn("CampusPreferenceStore.set")(function* (input: SetCampusPreferenceInput) {
		if (!Schema.is(SetCampusPreferenceSchema)(input)) {
			return yield* new InvalidCampusPreferenceError({
				detail: "Choose an available campus and a valid preference version",
			});
		}
		return yield* Effect.tryPromise({
			try: () =>
				db.transaction(async (tx) => {
					const [current] = await tx
						.select(selection)
						.from(users)
						.where(eq(users.firebaseUid, input.firebaseUid))
						.for("update");
					if (!current) {
						throw new CampusPreferenceError({ detail: "User profile is unavailable" });
					}
					const decision = preferenceChange(current, input);
					if (decision !== "update") {
						const [pending] = await tx
							.select({ userId: campusSubscriptionSync.userId })
							.from(campusSubscriptionSync)
							.where(eq(campusSubscriptionSync.userId, current.userId));
						return { ...current, conflict: decision === "conflict", syncPending: Boolean(pending) };
					}
					const version = current.campusPreferenceVersion + 1;
					await tx
						.update(users)
						.set({ preferredCampusSlug: input.campusSlug, campusPreferenceVersion: version })
						.where(eq(users.id, current.userId));
					await tx
						.insert(campusSubscriptionSync)
						.values({ userId: current.userId, version })
						.onConflictDoUpdate({
							target: campusSubscriptionSync.userId,
							set: { version, attempts: 0, nextAttemptAt: sql`now()` },
						});
					return {
						...current,
						preferredCampusSlug: input.campusSlug,
						campusPreferenceVersion: version,
						conflict: false,
						syncPending: true,
					};
				}),
			catch: (cause) =>
				new CampusPreferenceError({ detail: "Unable to save campus preference", cause }),
		});
	});
	const pending = Effect.fn("CampusPreferenceStore.pending")(function* () {
		return yield* Effect.tryPromise({
			try: () =>
				db
					.select({ firebaseUid: users.firebaseUid, version: campusSubscriptionSync.version })
					.from(campusSubscriptionSync)
					.innerJoin(users, eq(users.id, campusSubscriptionSync.userId))
					.where(lte(campusSubscriptionSync.nextAttemptAt, sql`now()`))
					.orderBy(campusSubscriptionSync.nextAttemptAt)
					.limit(25),
			catch: (cause) =>
				new CampusPreferenceError({ detail: "Unable to read pending campus subscriptions", cause }),
		});
	});
	const finish = Effect.fn("CampusPreferenceStore.finish")(function* (
		firebaseUid: string,
		version: number,
		success: boolean,
	) {
		const profile = yield* get(firebaseUid);
		const condition = and(
			eq(campusSubscriptionSync.userId, profile.userId),
			eq(campusSubscriptionSync.version, version),
		);
		yield* Effect.tryPromise({
			try: async () => {
				if (success) {
					await db.delete(campusSubscriptionSync).where(condition);
					return;
				}
				await db
					.update(campusSubscriptionSync)
					.set({
						attempts: sql`${campusSubscriptionSync.attempts} + 1`,
						nextAttemptAt: sql`now() + interval '1 minute' * least(60, power(2, least(${campusSubscriptionSync.attempts}, 6)))`,
					})
					.where(condition);
			},
			catch: (cause) =>
				new CampusPreferenceError({ detail: "Unable to record campus synchronization", cause }),
		});
	});
	return { get, set, pending, finish };
});

export class CampusPreferenceStore extends Context.Service<
	CampusPreferenceStore,
	Effect.Success<typeof make>
>()("CampusPreferenceStore") {}
export const CampusPreferenceStoreLive = Layer.effect(CampusPreferenceStore, make);
