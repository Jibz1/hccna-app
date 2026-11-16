import { buildRequestContextFromRequest, type RequestAuthPrincipal } from "@/effect/RequestContext";
import { createManagedRequestEffectRunner } from "@/effect/requestExecution";
import { AuthService, type AuthResult } from "@/effect/services/AuthService";
import { Effect } from "effect";
import { GraphQLError } from "graphql";

const authenticateRequestEffect = (request: Request) =>
	Effect.gen(function* () {
		const authService = yield* AuthService;
		return yield* authService.authenticateRequest(request);
	}).pipe(
		Effect.catchTag("AuthenticationUnavailableError", (error) => {
			const unavailable = new GraphQLError(
				"Authentication temporarily unavailable. Please retry.",
				{
					extensions: { code: "SERVICE_UNAVAILABLE", http: { status: 503 } },
				},
			);
			return Effect.logWarning("Firebase authentication temporarily unavailable").pipe(
				Effect.annotateLogs({ cause: error.cause }),
				Effect.andThen(Effect.fail(unavailable)),
			);
		}),
	);

export function authenticate(
	request: Request,
	metadata?: {
		readonly requestId?: string | undefined;
		readonly clientIp?: string | undefined;
		readonly auth?: RequestAuthPrincipal | undefined;
	},
): Promise<AuthResult | null | undefined> {
	const runRequestEffect = createManagedRequestEffectRunner(
		buildRequestContextFromRequest(request, metadata),
	);

	return runRequestEffect(authenticateRequestEffect(request));
}
