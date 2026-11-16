/**
 * Authentication methods that can populate the GraphQL context.
 */
export const GRAPHQL_AUTH_TYPES = {
	/**
	 * Full Firebase sign-in backed by a non-anonymous ID token.
	 */
	jwt: "jwt",
	/**
	 * Firebase anonymous sign-in issued by the mobile client.
	 */
	firebaseAnonymous: "firebaseAnonymous",
	/**
	 * Shared client/application token used by app bootstrap flows.
	 */
	token: "token",
	/**
	 * Allowlisted Google identity token for internal callers.
	 */
	googleInternal: "googleInternal",
	/**
	 * Google IAM identity token, typically from service-to-service calls.
	 */
	googleIam: "googleIam",
} as const;

type ResolvedGraphQLAuthType = (typeof GRAPHQL_AUTH_TYPES)[keyof typeof GRAPHQL_AUTH_TYPES];

export type GraphQLAuthType = ResolvedGraphQLAuthType | null;

/**
 * Auth types that represent a successful authentication result.
 */
type AuthorizedGraphQLAuthType = Exclude<GraphQLAuthType, null>;

/**
 * Auth types intended for direct mobile/client flows.
 */
export type ClientGraphQLAuthType =
	| typeof GRAPHQL_AUTH_TYPES.token
	| typeof GRAPHQL_AUTH_TYPES.firebaseAnonymous;

/**
 * Minimal auth-related fields every GraphQL context must expose.
 */
export interface AuthenticatedGraphQLContextContract {
	currentUserUid: string | null;
	currentUserEmail: string | null;
	authorized: boolean;
	authType: GraphQLAuthType;
}

/**
 * Requires a real signed-in Firebase user, not an anonymous or token-only caller.
 */
export type SignedInAuthContext<T extends AuthenticatedGraphQLContextContract> = T & {
	currentUserUid: NonNullable<T["currentUserUid"]>;
	currentUserEmail: NonNullable<T["currentUserEmail"]>;
	authorized: true;
	authType: typeof GRAPHQL_AUTH_TYPES.jwt;
};

/**
 * Requires any successful auth method.
 */
export type AuthorizedAuthContext<T extends AuthenticatedGraphQLContextContract> = T & {
	authorized: true;
	authType: AuthorizedGraphQLAuthType;
};

/**
 * Requires a Firebase JWT for a real signed-in account.
 */
export type JwtAuthContext<T extends AuthenticatedGraphQLContextContract> = T & {
	authorized: true;
	authType: typeof GRAPHQL_AUTH_TYPES.jwt;
};

/**
 * Requires the shared client/application token.
 */
export type TokenAuthContext<T extends AuthenticatedGraphQLContextContract> = T & {
	authorized: true;
	authType: typeof GRAPHQL_AUTH_TYPES.token;
};

/**
 * Requires Firebase anonymous auth from a client device.
 */
export type FirebaseAnonymousAuthContext<T extends AuthenticatedGraphQLContextContract> = T & {
	authorized: true;
	authType: typeof GRAPHQL_AUTH_TYPES.firebaseAnonymous;
};

/**
 * Requires a client-originating credential (`token` or `firebaseAnonymous`).
 */
export type ClientAuthContext<T extends AuthenticatedGraphQLContextContract> = T & {
	authorized: true;
	authType: ClientGraphQLAuthType;
};

/**
 * Requires an allowlisted internal Google identity token.
 */
export type GoogleInternalAuthContext<T extends AuthenticatedGraphQLContextContract> = T & {
	authorized: true;
	authType: typeof GRAPHQL_AUTH_TYPES.googleInternal;
};

/**
 * Requires a Google IAM identity token.
 */
export type GoogleIamAuthContext<T extends AuthenticatedGraphQLContextContract> = T & {
	authorized: true;
	authType: typeof GRAPHQL_AUTH_TYPES.googleIam;
};

/**
 * Named auth scopes used in GraphQL schema definitions.
 *
 * These comments are intended to surface in editor hovers/completions when
 * declaring `authScopes` on fields.
 */
export type FirebaseClientAuthContext<T extends AuthenticatedGraphQLContextContract> = T & {
	currentUserUid: string;
	authorized: true;
	authType: "jwt" | "firebaseAnonymous";
};

interface GraphQLAuthScopeDefinitions {
	firebaseClient: boolean;
	/**
	 * Requires a non-anonymous Firebase JWT with both `currentUserUid` and
	 * `currentUserEmail` available on the context.
	 */
	signedIn: boolean;
	/**
	 * Requires any successful authentication method:
	 * `jwt`, `firebaseAnonymous`, `token`, `googleInternal`, or `googleIam`.
	 */
	authorized: boolean;
	/**
	 * Requires client-originating auth only:
	 * `token` or `firebaseAnonymous`.
	 */
	clientAuth: boolean;
	/**
	 * Requires Firebase anonymous auth specifically.
	 */
	firebaseAnonymous: boolean;
	/**
	 * Requires an allowlisted Google identity token for internal systems.
	 */
	googleInternal: boolean;
	/**
	 * Requires a Google IAM identity token for service-to-service traffic.
	 */
	googleIam: boolean;
}

type ExclusiveAuthScope<K extends keyof GraphQLAuthScopeDefinitions> = Record<
	K,
	GraphQLAuthScopeDefinitions[K]
> &
	Partial<Record<Exclude<keyof GraphQLAuthScopeDefinitions, K>, never>>;

export type GraphQLAuthScopes =
	| ExclusiveAuthScope<"firebaseClient">
	| ExclusiveAuthScope<"signedIn">
	| ExclusiveAuthScope<"authorized">
	| ExclusiveAuthScope<"clientAuth">
	| ExclusiveAuthScope<"firebaseAnonymous">
	| ExclusiveAuthScope<"googleInternal">
	| ExclusiveAuthScope<"googleIam">;

export function isClientAuthType(authType: GraphQLAuthType): authType is ClientGraphQLAuthType {
	return authType === GRAPHQL_AUTH_TYPES.token || authType === GRAPHQL_AUTH_TYPES.firebaseAnonymous;
}
