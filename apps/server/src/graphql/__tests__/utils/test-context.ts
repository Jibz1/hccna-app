import { createRequestLoaders } from "@/graphql/loaders";
import { PathContext } from "@/graphql/pathContext";
import { buildStatsigUser } from "@/statsig/user";
/**
 * Mock GraphQL context utilities for testing.
 *
 * These utilities create mock GraphQL contexts for different authentication states.
 * Use them with the executeGraphQL helper to test queries and mutations.
 *
 * @example
 * ```typescript
 * import { anonymous, signedIn, googleInternal } from '../utils/test-context';
 *
 * // Test public queries
 * const result = await executeGraphQL(query, anonymous());
 *
 * // Test authenticated mutations
 * const result = await executeGraphQL(mutation, signedIn());
 *
 * // Test internal service calls
 * const result = await executeGraphQL(mutation, googleInternal());
 * ```
 */
import { Effect } from "effect";
import { Logger } from "graphql-yoga";

import type { GraphQLContext } from "@/graphql/context";
import type { DynamicConfig } from "@statsig/statsig-node-core";

type MockLoaders = GraphQLContext["loaders"];

const createMockLoaders = (): MockLoaders =>
	createRequestLoaders(<A>() => Promise.resolve<A>(null as never));

export interface MockContextOptions {
	currentUserUid?: string | null;
	currentUserEmail?: string | null;
	authorized?: boolean;
	authType?: GraphQLContext["authType"];
	loaders?: Partial<MockLoaders>;
	statsigEnabled?: boolean;
	checkGate?: (gateName: string) => boolean;
	dynamicConfigs?: Record<string, InstanceType<typeof DynamicConfig>["value"]>;
	effectRunPromise?: GraphQLContext["effect"]["runPromise"];
	effectRunPromiseDetached?: GraphQLContext["effect"]["runPromiseDetached"];
}

export function createMockContext(options: MockContextOptions = {}): GraphQLContext {
	const defaultLoaders = createMockLoaders();
	const statsigUser = buildStatsigUser({
		currentUserUid: options.currentUserUid ?? null,
		currentUserEmail: options.currentUserEmail ?? null,
		environment: "test",
	});

	return {
		request: new Request("http://localhost/graphql"),
		params: {},
		log: new Logger({ level: false }),
		waitUntil: () => {},
		pathContext: new PathContext(),
		currentUserUid: options.currentUserUid ?? null,
		currentUserEmail: options.currentUserEmail ?? null,
		authorized: options.authorized ?? false,
		authType: options.authType ?? null,
		statsigUser,
		statsig: {
			enabled: options.statsigEnabled ?? false,
			checkGate: (gateName: string) => (options.checkGate ? options.checkGate(gateName) : false),
			getFeatureGate: () => ({ value: false }) as never,
			getDynamicConfig: (configName: string) => {
				const configValue = options.dynamicConfigs?.[configName] ?? {};
				return {
					value: configValue,
					getValue: <T>(key: string, fallback: T) =>
						Object.hasOwn(configValue, key) ? (configValue[key] as T) : fallback,
				} as never;
			},
			getExperiment: () =>
				({
					value: {},
					getValue: <T>(_key: string, fallback: T) => fallback,
				}) as never,
			getLayer: () =>
				({
					value: {},
					getValue: <T>(_key: string, fallback: T) => fallback,
				}) as never,
			getClientInitializeResponse: () => "{}",
		},
		effect: {
			runPromise:
				options.effectRunPromise ??
				(<A, E, R>(program: Effect.Effect<A, E, R>) =>
					Effect.runPromise(program as Effect.Effect<A, E, never>)),
			runPromiseDetached:
				options.effectRunPromiseDetached ??
				(<A, E, R>(program: Effect.Effect<A, E, R>) =>
					Effect.runPromise(program as Effect.Effect<A, E, never>)),
		},
		loaders: {
			...defaultLoaders,
			...options.loaders,
		},
	};
}

/**
 * Anonymous context - no authentication
 */
export function anonymous(): GraphQLContext {
	return createMockContext({
		currentUserUid: null,
		currentUserEmail: null,
		authorized: false,
		authType: null,
	});
}

/**
 * Signed in user context - has uid + email (passes signedIn scope)
 */
export function signedIn(overrides: { uid?: string; email?: string } = {}): GraphQLContext {
	return createMockContext({
		currentUserUid: overrides.uid ?? "test-user-uid-123",
		currentUserEmail: overrides.email ?? "test@example.com",
		authorized: true,
		authType: "jwt",
	});
}

/**
 * Authorized context - general authorization without user identity
 */
export function authorized(overrides: MockContextOptions = {}): GraphQLContext {
	return createMockContext({
		...overrides,
		currentUserUid: null,
		currentUserEmail: null,
		authorized: true,
		authType: "token",
	});
}
