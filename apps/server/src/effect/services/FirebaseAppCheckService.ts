import { AppConfig } from "@/effect/AppConfig";
import {
	FirebaseAdminService,
	FirebaseAdminServiceLive,
	type FirebaseAppCheckVerifyTokenResponse,
} from "@/effect/services/FirebaseAdminService";
import { Context, Effect, Layer, Schema } from "effect";

export const FIREBASE_APP_CHECK_HEADER = "x-firebase-appcheck";

export class FirebaseAppCheckMissingTokenError extends Schema.TaggedError<FirebaseAppCheckMissingTokenError>()(
	"FirebaseAppCheckMissingTokenError",
	{
		headerName: Schema.String,
	},
	{ httpApiStatus: 401 },
) {
	readonly httpStatus = 401;
	readonly httpMessage = "Unauthorized";

	override get message() {
		return `Firebase App Check token is missing from ${this.headerName}`;
	}
}

class FirebaseAppCheckVerificationError extends Schema.TaggedError<FirebaseAppCheckVerificationError>()(
	"FirebaseAppCheckVerificationError",
	{
		detail: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
	{ httpApiStatus: 401 },
) {
	readonly httpStatus = 401;
	readonly httpMessage = "Unauthorized";

	override get message() {
		return `Firebase App Check verification failed: ${this.detail}`;
	}
}

class FirebaseAppCheckAppNotAllowedError extends Schema.TaggedError<FirebaseAppCheckAppNotAllowedError>()(
	"FirebaseAppCheckAppNotAllowedError",
	{
		appId: Schema.String,
	},
	{ httpApiStatus: 403 },
) {
	readonly httpStatus = 403;
	readonly httpMessage = "Forbidden";

	override get message() {
		return `Firebase App Check app is not allowed: ${this.appId}`;
	}
}

export type FirebaseAppCheckError =
	| FirebaseAppCheckMissingTokenError
	| FirebaseAppCheckVerificationError
	| FirebaseAppCheckAppNotAllowedError;

interface VerifiedFirebaseAppCheckToken {
	readonly appId: string;
	readonly alreadyConsumed: boolean;
	readonly token: FirebaseAppCheckVerifyTokenResponse["token"];
}

interface FirebaseAppCheckVerifier {
	verifyToken: (token: string) => Promise<FirebaseAppCheckVerifyTokenResponse>;
}

interface FirebaseAppCheckServiceContract {
	verifyRequest: (
		request: Request,
	) => Effect.Effect<VerifiedFirebaseAppCheckToken, FirebaseAppCheckError>;
}

function getRequestAppCheckToken(request: Request): string | null {
	return request.headers.get(FIREBASE_APP_CHECK_HEADER);
}

function makeFirebaseAppCheckServiceEffect(
	getVerifier: (firebase: FirebaseAdminService["Service"]) => FirebaseAppCheckVerifier,
): Effect.Effect<FirebaseAppCheckServiceContract, never, AppConfig | FirebaseAdminService> {
	return Effect.gen(function* () {
		const appConfig = yield* AppConfig;
		const firebase = yield* FirebaseAdminService;
		const verifier = getVerifier(firebase);

		const verifyRequest = Effect.fn("FirebaseAppCheckService.verifyRequest")(function* (
			request: Request,
		) {
			const token = getRequestAppCheckToken(request);
			if (!token) {
				return yield* Effect.fail(
					new FirebaseAppCheckMissingTokenError({
						headerName: FIREBASE_APP_CHECK_HEADER,
					}),
				);
			}

			const response = yield* Effect.tryPromise({
				try: () => verifier.verifyToken(token),
				catch: (cause) =>
					new FirebaseAppCheckVerificationError({
						detail: "Token rejected by Firebase Admin",
						cause,
					}),
			});
			const appId = response.appId || response.token.app_id;

			if (
				appConfig.appCheck.allowedAppIds.length > 0 &&
				!appConfig.appCheck.allowedAppIds.includes(appId)
			) {
				return yield* Effect.fail(
					new FirebaseAppCheckAppNotAllowedError({
						appId,
					}),
				);
			}

			return {
				appId,
				alreadyConsumed: response.alreadyConsumed ?? false,
				token: response.token,
			} satisfies VerifiedFirebaseAppCheckToken;
		});

		return { verifyRequest } satisfies FirebaseAppCheckServiceContract;
	});
}

export class FirebaseAppCheckService extends Context.Service<
	FirebaseAppCheckService,
	FirebaseAppCheckServiceContract
>()("FirebaseAppCheckService", {
	make: makeFirebaseAppCheckServiceEffect((firebase) => ({
		verifyToken: firebase.verifyAppCheckToken,
	})),
}) {}

export const FirebaseAppCheckServiceLive = Layer.effect(
	FirebaseAppCheckService,
	FirebaseAppCheckService.make,
).pipe(Layer.provide(FirebaseAdminServiceLive));

export const makeFirebaseAppCheckServiceLayer = (verifier: FirebaseAppCheckVerifier) =>
	Layer.effect(
		FirebaseAppCheckService,
		makeFirebaseAppCheckServiceEffect(() => verifier),
	);
