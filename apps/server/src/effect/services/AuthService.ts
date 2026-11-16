import { AppConfig } from "@/effect/AppConfig";
import { FirebaseAdminService } from "@/effect/services/FirebaseAdminService";
import { FirebaseAuthService } from "@/effect/services/FirebaseAuthService";
import { GRAPHQL_AUTH_TYPES, type GraphQLAuthType } from "@/graphql/auth-model";
import { getClientTelemetryMetadata } from "@/platform/observability/request";
import { Temporal } from "@js-temporal/polyfill";
import { Context, Effect, Layer, Schema } from "effect";
import { OAuth2Client } from "google-auth-library";
import { LRUCache } from "lru-cache";

export interface AuthResult {
	uid: string | null;
	email?: string | null;
	authorized: boolean;
	authType: GraphQLAuthType;
}

class SharedTokenAuthError extends Schema.TaggedError<SharedTokenAuthError>()(
	"SharedTokenAuthError",
	{
		detail: Schema.String,
		cause: Schema.optional(Schema.Unknown),
	},
	{ httpApiStatus: 401 },
) {
	readonly httpMessage = "Unauthorized";
	readonly httpStatus = 401;

	override get message() {
		return `Shared token authentication failed: ${this.detail}`;
	}
}

type AuthMethod = "firebase" | "googleIam" | "googleInternal" | "token";

class AuthenticationUnavailableError extends Schema.TaggedError<AuthenticationUnavailableError>()(
	"AuthenticationUnavailableError",
	{ cause: Schema.Unknown },
) {}

const invalidFirebaseCredentialCodes = new Set([
	"auth/argument-error",
	"auth/invalid-argument",
	"auth/invalid-id-token",
	"auth/id-token-expired",
	"auth/id-token-revoked",
	"auth/user-disabled",
	"auth/user-not-found",
]);

interface AuthServiceContract {
	authenticateRequest: (
		request: Request,
	) => Effect.Effect<AuthResult | null | undefined, AuthenticationUnavailableError>;
	verifySharedToken: (token: string) => Effect.Effect<boolean, SharedTokenAuthError>;
}

const authMethodCache = new LRUCache<string, AuthMethod>({
	max: 500,
	ttl: Temporal.Duration.from({ minutes: 5 }).total({ unit: "milliseconds" }),
	allowStale: false,
});

// User activity is best-effort telemetry, not authentication state. Coalescing
// updates avoids placing a Firestore transaction on every authenticated request.
const USER_ACTIVITY_UPDATE_TTL_MS = Temporal.Duration.from({
	minutes: 10,
}).total({ unit: "milliseconds" });
const USER_ACTIVITY_WRITE_TIMEOUT_MS = Temporal.Duration.from({
	seconds: 5,
}).total({ unit: "milliseconds" });

// The shared client token lives in a Firestore config doc; without caching,
// every shared-token request pays a Firestore round-trip. The cached value is
// refreshed at most every 60s, and a mismatch against a cached value triggers
// one immediate refetch so token rotation takes effect right away (the OLD
// token keeps working for at most 60s after rotation — the bounded window).
const SHARED_TOKEN_CONFIG_TTL_MS = Temporal.Duration.from({
	seconds: 60,
}).total({ unit: "milliseconds" });

const oAuth2Client = new OAuth2Client();

function extractToken(authorizationHeader: string | null | undefined) {
	if (!authorizationHeader) {
		return null;
	}

	const [scheme, token] = authorizationHeader.split(" ");
	if (scheme?.toLowerCase() !== "bearer") {
		return null;
	}

	return token || null;
}

async function hashToken(token: string): Promise<string> {
	const data = new TextEncoder().encode(token);
	const hash = await crypto.subtle.digest("SHA-256", data);
	return Buffer.from(hash).toString("hex");
}

function isLikelyJwt(token: string): boolean {
	return token.split(".").length === 3;
}

export class AuthService extends Context.Service<AuthService, AuthServiceContract>()(
	"AuthService",
	{
		make: Effect.gen(function* () {
			const appConfig = yield* AppConfig;
			const firebase = yield* FirebaseAdminService;
			const firebaseAuth = yield* FirebaseAuthService;
			const recentUserActivityUpdates = new LRUCache<string, true>({
				max: 10_000,
				ttl: USER_ACTIVITY_UPDATE_TTL_MS,
				allowStale: false,
			});

			const writeUserActivity = Effect.fn("AuthService.writeUserActivity")(function* (
				firebaseUid: string,
				appVersion: string | undefined,
			) {
				yield* firebase.updateUserActivity(firebaseUid, appVersion).pipe(
					Effect.timeout(USER_ACTIVITY_WRITE_TIMEOUT_MS),
					Effect.catchTags({
						FirebaseFirestoreWriteError: (error) =>
							Effect.logWarning("Failed to record authenticated user activity").pipe(
								Effect.annotateLogs({
									cause: error,
									firebaseUid,
								}),
							),
						TimeoutError: (error) =>
							Effect.logWarning("Timed out recording authenticated user activity").pipe(
								Effect.annotateLogs({
									cause: error,
									firebaseUid,
									timeoutMs: USER_ACTIVITY_WRITE_TIMEOUT_MS,
								}),
							),
					}),
				);
			});

			const recordUserActivity = Effect.fn("AuthService.recordUserActivity")(function* (
				result: AuthResult | null,
				request: Request,
			) {
				if (result?.authType !== GRAPHQL_AUTH_TYPES.jwt || !result.uid) {
					return result;
				}

				const { appVersion } = getClientTelemetryMetadata(request.headers);
				// Keyed by version too: users relaunch within the window after a store update.
				const activityKey = JSON.stringify([result.uid, appVersion]);
				if (recentUserActivityUpdates.has(activityKey)) {
					return result;
				}

				recentUserActivityUpdates.set(activityKey, true);
				yield* Effect.forkDetach(
					writeUserActivity(result.uid, appVersion === "unknown" ? undefined : appVersion),
				);

				return result;
			});

			const verifyFirebaseJwt = (token: string) =>
				firebaseAuth.verifyIdToken(token).pipe(
					Effect.map((decodedToken): AuthResult | null => {
						const signInProvider = decodedToken.firebase?.sign_in_provider;
						const isAnonymousProvider = signInProvider === "anonymous";

						const result: AuthResult = {
							uid: decodedToken.uid,
							email: decodedToken.email || null,
							authorized: true,
							authType: isAnonymousProvider
								? GRAPHQL_AUTH_TYPES.firebaseAnonymous
								: GRAPHQL_AUTH_TYPES.jwt,
						};

						return result;
					}),
					Effect.catchTag("FirebaseAuthError", (error) =>
						error.code && invalidFirebaseCredentialCodes.has(error.code)
							? Effect.succeed(null)
							: Effect.fail(new AuthenticationUnavailableError({ cause: error })),
					),
				);

			const verifyGoogleInternal = (token: string) =>
				Effect.tryPromise({
					try: async (): Promise<AuthResult | null> => {
						if (!appConfig.auth.cloudRunServiceUrl) {
							return null;
						}

						const ticket = await oAuth2Client.verifyIdToken({
							idToken: token,
							audience: appConfig.auth.cloudRunServiceUrl,
						});
						const payload = ticket.getPayload();

						if (
							!payload?.email ||
							payload.email_verified !== true ||
							!appConfig.auth.googleInternalAllowedEmails.includes(payload.email)
						) {
							return null;
						}

						return {
							uid: null,
							email: payload.email,
							authorized: true,
							authType: GRAPHQL_AUTH_TYPES.googleInternal,
						};
					},
					catch: () => null,
				}).pipe(Effect.catch(() => Effect.succeed(null)));

			const verifyGoogleIam = (token: string) =>
				Effect.tryPromise({
					try: async (): Promise<AuthResult | null> => {
						if (!appConfig.auth.cloudRunServiceUrl) {
							return null;
						}

						const ticket = await oAuth2Client.verifyIdToken({
							idToken: token,
							audience: appConfig.auth.cloudRunServiceUrl,
						});
						const payload = ticket.getPayload();

						if (!payload?.email || payload.email_verified !== true) {
							return null;
						}

						return {
							uid: null,
							email: payload.email,
							authorized: true,
							authType: GRAPHQL_AUTH_TYPES.googleIam,
						};
					},
					catch: () => null,
				}).pipe(Effect.catch(() => Effect.succeed(null)));

			let sharedTokenConfigCache: {
				readonly token: unknown;
				readonly fetchedAt: number;
			} | null = null;

			const fetchConfiguredSharedToken = Effect.fn("AuthService.fetchConfiguredSharedToken")(
				function* () {
					const configSnapshot = yield* Effect.tryPromise({
						try: () =>
							firebase.db
								.collection(firebase.collections.config)
								.doc(firebase.collections.userConfigDoc)
								.get(),
						catch: (cause) =>
							new SharedTokenAuthError({
								detail: "Failed to load shared client token",
								cause,
							}),
					});

					const configuredToken: unknown = configSnapshot.data()?.token;
					sharedTokenConfigCache = {
						token: configuredToken,
						fetchedAt: Date.now(),
					};
					return configuredToken;
				},
			);

			const verifySharedToken = Effect.fn("AuthService.verifySharedToken")(function* (
				token: string,
			) {
				const cached = sharedTokenConfigCache;
				const isFresh =
					cached !== null && Date.now() - cached.fetchedAt < SHARED_TOKEN_CONFIG_TTL_MS;

				if (isFresh && cached.token === token) {
					return true;
				}

				// Stale cache, or a mismatch that may mean the token was rotated:
				// re-read the config doc so a freshly rotated token works immediately.
				const configuredToken = yield* fetchConfiguredSharedToken();
				return configuredToken === token;
			});

			const authenticateRequest = Effect.fn("AuthService.authenticateRequest")(function* (
				request: Request,
			) {
				const token = extractToken(request.headers.get("authorization"));
				if (!token) {
					return;
				}

				const hintedMethod = request.headers.get("x-auth-method");
				const authMethods = {
					firebase: verifyFirebaseJwt,
					googleIam: verifyGoogleIam,
					googleInternal: verifyGoogleInternal,
					token: (candidate: string) =>
						verifySharedToken(candidate).pipe(
							Effect.map((authorized) =>
								authorized
									? {
											uid: null,
											email: null,
											authorized: true,
											authType: GRAPHQL_AUTH_TYPES.token,
										}
									: null,
							),
							Effect.catch(() => Effect.succeed(null)),
						),
				} satisfies Record<
					AuthMethod,
					(candidate: string) => Effect.Effect<AuthResult | null, AuthenticationUnavailableError>
				>;

				const tryMethod = (method: AuthMethod) => authMethods[method](token);

				if (
					hintedMethod &&
					(hintedMethod === "firebase" ||
						hintedMethod === "googleIam" ||
						hintedMethod === "googleInternal" ||
						hintedMethod === "token")
				) {
					return yield* recordUserActivity(yield* tryMethod(hintedMethod), request);
				}

				const tokenHash = yield* Effect.tryPromise(() => hashToken(token)).pipe(
					Effect.catch(() => Effect.succeed("")),
				);
				const cachedMethod = tokenHash ? authMethodCache.get(tokenHash) : undefined;
				if (cachedMethod) {
					const cachedMethodResult = yield* tryMethod(cachedMethod);
					if (cachedMethodResult?.authorized) {
						return yield* recordUserActivity(cachedMethodResult, request);
					}
					authMethodCache.delete(tokenHash);
				}

				const methods: readonly AuthMethod[] = isLikelyJwt(token)
					? ["firebase", "googleInternal", "googleIam", "token"]
					: ["token"];

				for (const method of methods.filter((candidate) => candidate !== cachedMethod)) {
					const result = yield* tryMethod(method);
					if (result?.authorized) {
						if (tokenHash) {
							authMethodCache.set(tokenHash, method);
						}
						return yield* recordUserActivity(result, request);
					}
				}

				return null;
			});

			return {
				authenticateRequest,
				verifySharedToken,
			};
		}),
	},
) {}

export const AuthServiceLive = Layer.effect(AuthService, AuthService.make);
