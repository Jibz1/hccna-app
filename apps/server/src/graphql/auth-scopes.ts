import type { GraphQLAuthScopes } from "./auth-model";

interface GraphQLAuthScopePresets {
	readonly firebaseClient: Extract<GraphQLAuthScopes, { firebaseClient: boolean }>;
	/**
	 * Requires a non-anonymous Firebase JWT with both `currentUserUid` and
	 * `currentUserEmail` available on the context.
	 */
	readonly signedIn: Extract<GraphQLAuthScopes, { signedIn: boolean }>;
	/**
	 * Requires any successful authentication method:
	 * `jwt`, `firebaseAnonymous`, `token`, `googleInternal`, or `googleIam`.
	 */
	readonly authorized: Extract<GraphQLAuthScopes, { authorized: boolean }>;
	/**
	 * Requires client-originating auth only:
	 * `token` or `firebaseAnonymous`.
	 */
	readonly clientAuth: Extract<GraphQLAuthScopes, { clientAuth: boolean }>;
	/**
	 * Requires Firebase anonymous auth specifically.
	 */
	readonly firebaseAnonymous: Extract<GraphQLAuthScopes, { firebaseAnonymous: boolean }>;
	/**
	 * Requires an allowlisted Google identity token for internal systems.
	 */
	readonly googleInternal: Extract<GraphQLAuthScopes, { googleInternal: boolean }>;
	/**
	 * Requires a Google IAM identity token for service-to-service traffic.
	 */
	readonly googleIam: Extract<GraphQLAuthScopes, { googleIam: boolean }>;
}

/**
 * Reusable auth-scope presets for GraphQL schema definitions.
 *
 * Prefer `authScope.authorized` over inline objects like
 * `{ authorized: true }` when you want useful editor hover text.
 */
export const authScope: GraphQLAuthScopePresets = {
	firebaseClient: { firebaseClient: true },
	signedIn: { signedIn: true },
	authorized: { authorized: true },
	clientAuth: { clientAuth: true },
	firebaseAnonymous: { firebaseAnonymous: true },
	googleInternal: { googleInternal: true },
	googleIam: { googleIam: true },
};
