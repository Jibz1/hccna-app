import { db, pool } from "@/db";
import { Context, Effect, Layer } from "effect";

interface DrizzleServiceContract {
	readonly db: typeof db;
	readonly pool: typeof pool;
}

export class DrizzleService extends Context.Service<DrizzleService, DrizzleServiceContract>()(
	"DrizzleService",
	{
		make: Effect.succeed({
			db,
			pool,
		} satisfies DrizzleServiceContract),
	},
) {
	static readonly layer = Layer.effect(DrizzleService, DrizzleService.make);
}

export const DrizzleServiceLive = Layer.effect(DrizzleService, DrizzleService.make);
