import {
	FirebaseAdminService,
	FirebaseAdminServiceLive,
} from "@/effect/services/FirebaseAdminService";
import { Context, Duration, Effect, Layer, Predicate, Schema } from "effect";

import type {
	ActionCodeSettings,
	CreateRequest,
	DecodedIdToken,
	UserRecord,
} from "firebase-admin/auth";

export class FirebaseAuthError extends Schema.TaggedError<FirebaseAuthError>()(
	"FirebaseAuthError",
	{
		operation: Schema.String,
		code: Schema.optional(Schema.String),
		cause: Schema.optional(Schema.Unknown),
	},
) {
	override get message() {
		return `Firebase auth: ${this.operation} failed`;
	}
}

interface FirebaseAuthServiceContract {
	createCustomToken: (uid: string) => Effect.Effect<string, FirebaseAuthError>;
	createUser: (input: CreateRequest) => Effect.Effect<UserRecord, FirebaseAuthError>;
	generateSignInWithEmailLink: (
		email: string,
		actionCodeSettings: ActionCodeSettings,
	) => Effect.Effect<string, FirebaseAuthError>;
	getUser: (uid: string) => Effect.Effect<UserRecord, FirebaseAuthError>;
	getUserByEmail: (email: string) => Effect.Effect<UserRecord, FirebaseAuthError>;
	listAllUsers: () => Effect.Effect<UserRecord[], FirebaseAuthError>;
	verifyIdToken: (token: string) => Effect.Effect<DecodedIdToken, FirebaseAuthError>;
}

const toFirebaseAuthError = (operation: string) => (cause: unknown) =>
	new FirebaseAuthError({
		operation,
		cause,
		code: Predicate.isObject(cause) && Predicate.isString(cause.code) ? cause.code : undefined,
	});

export const FIREBASE_TOKEN_VERIFICATION_TIMEOUT_MS = Duration.toMillis("5 seconds");

export class FirebaseAuthService extends Context.Service<
	FirebaseAuthService,
	FirebaseAuthServiceContract
>()("FirebaseAuthService", {
	make: makeFirebaseAuthServiceEffect(),
}) {}

export const FirebaseAuthServiceLive = Layer.effect(
	FirebaseAuthService,
	FirebaseAuthService.make,
).pipe(Layer.provide(FirebaseAdminServiceLive));

export const makeFirebaseAuthServiceLayer = () =>
	Layer.effect(FirebaseAuthService, makeFirebaseAuthServiceEffect());

function makeFirebaseAuthServiceEffect(): Effect.Effect<
	FirebaseAuthServiceContract,
	never,
	FirebaseAdminService
> {
	return Effect.gen(function* () {
		const firebase = yield* FirebaseAdminService;

		return {
			createCustomToken: Effect.fn("FirebaseAuthService.createCustomToken")(function* (
				uid: string,
			) {
				return yield* Effect.tryPromise({
					try: () => firebase.auth.createCustomToken(uid),
					catch: toFirebaseAuthError("createCustomToken"),
				});
			}),
			createUser: Effect.fn("FirebaseAuthService.createUser")(function* (input: CreateRequest) {
				return yield* Effect.tryPromise({
					try: () => firebase.auth.createUser(input),
					catch: toFirebaseAuthError("createUser"),
				});
			}),
			generateSignInWithEmailLink: Effect.fn("FirebaseAuthService.generateSignInWithEmailLink")(
				function* (email: string, actionCodeSettings: ActionCodeSettings) {
					return yield* Effect.tryPromise({
						try: () => firebase.auth.generateSignInWithEmailLink(email, actionCodeSettings),
						catch: toFirebaseAuthError("generateSignInWithEmailLink"),
					});
				},
			),
			getUser: Effect.fn("FirebaseAuthService.getUser")(function* (uid: string) {
				return yield* Effect.tryPromise({
					try: () => firebase.auth.getUser(uid),
					catch: toFirebaseAuthError("getUser"),
				});
			}),
			getUserByEmail: Effect.fn("FirebaseAuthService.getUserByEmail")(function* (email: string) {
				return yield* Effect.tryPromise({
					try: () => firebase.auth.getUserByEmail(email),
					catch: toFirebaseAuthError("getUserByEmail"),
				});
			}),
			listAllUsers: Effect.fn("FirebaseAuthService.listAllUsers")(function* () {
				const fetchPage = (pageToken?: string) =>
					Effect.tryPromise({
						try: () => firebase.auth.listUsers(1000, pageToken),
						catch: toFirebaseAuthError("listAllUsers"),
					});

				const users: UserRecord[] = [];
				let page = yield* fetchPage();
				users.push(...page.users);
				while (page.pageToken) {
					page = yield* fetchPage(page.pageToken);
					users.push(...page.users);
				}
				return users;
			}),
			verifyIdToken: Effect.fn("FirebaseAuthService.verifyIdToken")(function* (token: string) {
				return yield* Effect.tryPromise({
					try: () => firebase.auth.verifyIdToken(token, true),
					catch: toFirebaseAuthError("verifyIdToken"),
				}).pipe(
					Effect.timeout(FIREBASE_TOKEN_VERIFICATION_TIMEOUT_MS),
					Effect.catchTag("TimeoutError", (cause) =>
						Effect.fail(
							new FirebaseAuthError({
								operation: "verifyIdToken",
								code: "auth/verification-timeout",
								cause,
							}),
						),
					),
				);
			}),
		} satisfies FirebaseAuthServiceContract;
	});
}
