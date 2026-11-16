import { coreSettings, upComingEvents } from "@/db/schema";
import { CMSFetchError, CMSNotFoundError } from "@/effect/services/CMSErrors";
import { DrizzleService } from "@/effect/services/DrizzleService";
import { Effect } from "effect";

type CoreSettingsData = typeof coreSettings.$inferInsert;

export const fetchCoreSettingsRow = Effect.gen(function* () {
	const { db } = yield* DrizzleService;
	const result = yield* Effect.tryPromise({
		try: () => db.select().from(coreSettings).limit(1),
		catch: (error) =>
			new CMSFetchError({
				detail: "Failed to fetch core settings from PostgreSQL",
				cause: error,
			}),
	});

	const [data] = result;
	if (!data) {
		return yield* Effect.fail(
			new CMSNotFoundError({
				resource: "core settings",
			}),
		);
	}

	return data;
}).pipe(Effect.withSpan("CMSRepository.fetchCoreSettingsRow"));

export const fetchUpcomingEventRows = Effect.gen(function* () {
	const { db } = yield* DrizzleService;
	return yield* Effect.tryPromise({
		try: () => db.select().from(upComingEvents),
		catch: (cause) => new CMSFetchError({ detail: "Failed to fetch upcoming events", cause }),
	});
});

export const upsertCoreSettings = (values: CoreSettingsData) =>
	Effect.gen(function* () {
		const { db } = yield* DrizzleService;
		return yield* Effect.tryPromise({
			try: () =>
				db
					.insert(coreSettings)
					.values(values)
					.onConflictDoUpdate({
						target: coreSettings.id,
						set: {
							...values,
							id: undefined,
							updatedAt: new Date(),
						},
					}),
			catch: (error) =>
				new CMSFetchError({
					detail: "Failed to save core settings to PostgreSQL",
					cause: error,
				}),
		});
	}).pipe(Effect.withSpan("CMSRepository.upsertCoreSettings"));
