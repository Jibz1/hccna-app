import { AppConfig, type AppConfigContract } from "@/effect/AppConfig";
import { testAppConfig } from "@/effect/services/__tests__/fixtures";
import {
	FIREBASE_APP_CHECK_HEADER,
	FirebaseAppCheckMissingTokenError,
	FirebaseAppCheckService,
} from "@/effect/services/FirebaseAppCheckService";
import { appCheckMiddleware } from "@/transport/http/appCheckMiddleware";
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { Hono, type Context } from "hono";

function makeConfig(appCheck: AppConfigContract["appCheck"]): AppConfigContract {
	return {
		...testAppConfig,
		appCheck,
	};
}

function buildApp(
	config: AppConfigContract,
	verifyRequest: FirebaseAppCheckService["Service"]["verifyRequest"],
) {
	const layer = Layer.mergeAll(
		Layer.succeed(AppConfig, config as never),
		Layer.succeed(FirebaseAppCheckService, { verifyRequest } as never),
	);
	const app = new Hono();
	app.use(
		"/graphql",
		appCheckMiddleware({
			runHonoEffect: <A, E, R>(_context: Context, program: Effect.Effect<A, E, R>) =>
				Effect.runPromise(Effect.provide(program as Effect.Effect<A, E, never>, layer as never)),
		}),
	);
	app.post("/graphql", (context) => context.json({ ok: true }));
	return app;
}

function missingTokenError() {
	return new FirebaseAppCheckMissingTokenError({
		headerName: FIREBASE_APP_CHECK_HEADER,
	});
}

describe("appCheckMiddleware", () => {
	it("rejects enforce-mode requests when verification fails", async () => {
		const app = buildApp(makeConfig({ enforcement: "enforce", allowedAppIds: [] }), () =>
			Effect.fail(missingTokenError()),
		);

		const response = await app.request("/graphql", { method: "POST" });

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			errors: [
				{
					message: "Unauthorized",
					extensions: {
						code: "APP_CHECK_UNAUTHORIZED",
					},
				},
			],
		});
	});
});
