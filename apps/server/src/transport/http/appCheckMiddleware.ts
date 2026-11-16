import { AppConfig } from "@/effect/AppConfig";
import {
	FirebaseAppCheckService,
	type FirebaseAppCheckError,
} from "@/effect/services/FirebaseAppCheckService";
import { runHonoEffect, type HonoEffectRunner } from "@/transport/http/honoEffectRunner";
import { getLogger } from "@/transport/http/pinoLoggerMiddleware";
import { Effect } from "effect";

import type { Context, MiddlewareHandler, Next } from "hono";

type AppCheckResult =
	| {
			readonly status: "disabled";
	  }
	| {
			readonly status: "verified";
			readonly appId: string;
	  }
	| {
			readonly status: "monitor-failed";
			readonly error: FirebaseAppCheckError;
	  }
	| {
			readonly status: "rejected";
			readonly error: FirebaseAppCheckError;
	  };

interface AppCheckMiddlewareDeps {
	readonly runHonoEffect?: HonoEffectRunner;
}

const logger = getLogger();

function getGraphQLAppCheckFailureResponse(context: Context, error: FirebaseAppCheckError) {
	const status = error.httpStatus;
	const code = status === 403 ? "APP_CHECK_FORBIDDEN" : "APP_CHECK_UNAUTHORIZED";

	return context.json(
		{
			errors: [
				{
					message: error.httpMessage,
					extensions: {
						code,
					},
				},
			],
		},
		status,
	);
}

const checkAppCheckRequest = (
	request: Request,
): Effect.Effect<AppCheckResult, never, AppConfig | FirebaseAppCheckService> =>
	Effect.gen(function* () {
		const appConfig = yield* AppConfig;

		if (appConfig.appCheck.enforcement === "off") {
			return { status: "disabled" } as const;
		}

		const appCheck = yield* FirebaseAppCheckService;
		return yield* appCheck.verifyRequest(request).pipe(
			Effect.match({
				onFailure: (error): AppCheckResult =>
					appConfig.appCheck.enforcement === "monitor"
						? { status: "monitor-failed", error }
						: { status: "rejected", error },
				onSuccess: (result): AppCheckResult => ({
					status: "verified",
					appId: result.appId,
				}),
			}),
		);
	});

export function appCheckMiddleware(deps?: AppCheckMiddlewareDeps): MiddlewareHandler {
	const runEffectForRequest = deps?.runHonoEffect ?? runHonoEffect;

	return async (context: Context, next: Next) => {
		const result = await runEffectForRequest(context, checkAppCheckRequest(context.req.raw));

		switch (result.status) {
			case "disabled":
			case "verified": {
				await next();
				return;
			}
			case "monitor-failed": {
				logger.warn(
					{
						errorTag: result.error._tag,
						path: context.req.path,
					},
					"Firebase App Check monitor failure",
				);
				await next();
				return;
			}
			case "rejected": {
				logger.warn(
					{
						errorTag: result.error._tag,
						path: context.req.path,
					},
					"Firebase App Check rejected request",
				);
				return getGraphQLAppCheckFailureResponse(context, result.error);
			}
		}
	};
}
