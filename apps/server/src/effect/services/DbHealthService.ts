import { DrizzleService } from "@/effect/services/DrizzleService";
import { Context, Effect, Layer } from "effect";

interface DbHealthServiceContract {
	readonly check: Effect.Effect<void, Error>;
}

export class DbHealthService extends Context.Service<DbHealthService, DbHealthServiceContract>()(
	"DbHealthService",
	{
		make: Effect.gen(function* () {
			const { pool } = yield* DrizzleService;

			return {
				check: Effect.tryPromise({
					try: async () => {
						await pool.query("select 1");
					},
					catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
				}),
			} satisfies DbHealthServiceContract;
		}),
	},
) {
	static readonly layer = Layer.effect(DbHealthService, DbHealthService.make);
}

export const DbHealthServiceLive = Layer.effect(DbHealthService, DbHealthService.make);
