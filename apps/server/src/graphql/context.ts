import { AppConfig } from "@/effect/AppConfig";
import { FirebaseAdminContext } from "@/effect/FirebaseAdminContext";
import {
	buildRequestContextFromRequest,
	type RequestAuthPrincipal,
	type RequestContext,
} from "@/effect/RequestContext";
import {
	createManagedRequestEffectRunner,
	type AppRuntimeContext,
} from "@/effect/requestExecution";
import { StatsigService } from "@/effect/StatsigService";
import { createRequestLoaders, type CommonDataLoader } from "@/graphql/loaders";
import { PathContext } from "@/graphql/pathContext";
import {
	buildStatsigUser,
	createGraphQLStatsigFacade,
	type GraphQLStatsigFacade,
} from "@/statsig/user";
import {
	app,
	AppCollections,
	db,
	dbFieldValue,
	FBPaths,
	fieldPath,
	secondaryApp,
	secondaryDb,
} from "@/utils/firebase";
import * as Sentry from "@sentry/bun";
import { Effect } from "effect";

import { authenticate } from "./authenticator";

import type { AuthenticatedGraphQLContextContract, GraphQLAuthType } from "./auth-model";
import type { EffectRunner } from "@/effect/DataLoaderFactory";
import type { StatsigUser } from "@statsig/statsig-node-core";
import type { YogaInitialContext } from "graphql-yoga";
import type { Context } from "hono";

interface PathContextValues {
	userId: string;
}

export interface ServerContext {
	response: Context["res"];
	requestId?: string | undefined;
	clientIp?: string | undefined;
}

export type GraphQLContext = YogaInitialContext & {
	pathContext: PathContext<PathContextValues>;
	currentUserUid: string | null;
	currentUserEmail: string | null;
	authorized: boolean;
	statsigUser: StatsigUser;
	statsig: GraphQLStatsigFacade;
	/**
	 * Authentication method that populated this request context.
	 *
	 * - `jwt`: full Firebase sign-in for a real user account
	 * - `firebaseAnonymous`: anonymous Firebase client auth
	 * - `token`: shared client/application token
	 * - `googleInternal`: allowlisted Google identity token
	 * - `googleIam`: Google IAM identity token
	 * - `null`: unauthenticated request
	 */
	authType: GraphQLAuthType;
	loaders: CommonDataLoader;
	effect: {
		runPromise: EffectRunner<AppRuntimeContext | FirebaseAdminContext | RequestContext>;
		runPromiseDetached: EffectRunner<AppRuntimeContext | FirebaseAdminContext | RequestContext>;
	};
} & AuthenticatedGraphQLContextContract;

function toRequestAuthPrincipal(
	authResult: Awaited<ReturnType<typeof authenticate>>,
): RequestAuthPrincipal | undefined {
	if (!authResult) {
		return undefined;
	}

	return {
		uid: authResult.uid ?? undefined,
		email: authResult.email ?? undefined,
		authType: authResult.authType,
		authorized: authResult.authorized,
	};
}

export const createGraphQLContext = (c: ServerContext & YogaInitialContext) =>
	Sentry.startSpan(
		{
			op: "function",
			name: "createGraphQLContext",
		},
		async () => {
			const authHeader = c.request.headers.get("authorization");
			const baseRequestContext = buildRequestContextFromRequest(c.request, {
				clientIp: c.clientIp,
				requestId: c.requestId,
			});
			const runBaseRequestEffect = createManagedRequestEffectRunner(baseRequestContext);
			const [authResult, statsigContext] = await Promise.all([
				authenticate(c.request, {
					clientIp: c.clientIp,
					requestId: c.requestId,
				}),
				runBaseRequestEffect(
					Effect.gen(function* () {
						const statsigService = yield* StatsigService;
						const appConfig = yield* AppConfig;
						return {
							statsigService,
							statsigEnvironment: appConfig.statsig.environment ?? appConfig.nodeEnv,
						};
					}),
				),
			]);
			const requestContext = buildRequestContextFromRequest(c.request, {
				auth: toRequestAuthPrincipal(authResult),
				clientIp: c.clientIp,
				requestId: c.requestId,
			});
			const runRequestEffect = createManagedRequestEffectRunner(requestContext);
			const detachedRequestContext = {
				...requestContext,
				signal: new AbortController().signal,
			};
			const runDetachedRequestEffect = createManagedRequestEffectRunner(detachedRequestContext);
			const currentUserUid = authResult?.uid ?? null;
			const currentUserEmail = authResult?.email ?? null;
			const statsigUser = buildStatsigUser({
				currentUserUid,
				currentUserEmail,
				environment: statsigContext.statsigEnvironment,
			});
			const statsig = createGraphQLStatsigFacade(statsigContext.statsigService, statsigUser);
			const firebaseAdminContext = FirebaseAdminContext.context({
				app,
				secondaryApp,
				db,
				secondaryDb,
				dbFieldValue,
				fieldPath,
				FBPaths,
				AppCollections,
			});
			const defaultResponse = {
				...c,
				pathContext: new PathContext<PathContextValues>(),
				loaders: createRequestLoaders(runRequestEffect, currentUserUid),
				// oxlint-disable-next-line no-null
				currentUserUid,
				// oxlint-disable-next-line no-null
				currentUserEmail,
				authorized: authResult?.authorized ?? false,
				statsigUser,
				statsig,
				// oxlint-disable-next-line no-null
				authType: authResult?.authType ?? null,
				effect: {
					runPromise: <A, E, R extends AppRuntimeContext | FirebaseAdminContext | RequestContext>(
						program: Effect.Effect<A, E, R>,
					) => runRequestEffect(program.pipe(Effect.provide(firebaseAdminContext))),
					runPromiseDetached: <
						A,
						E,
						R extends AppRuntimeContext | FirebaseAdminContext | RequestContext,
					>(
						program: Effect.Effect<A, E, R>,
					) => runDetachedRequestEffect(program.pipe(Effect.provide(firebaseAdminContext))),
				},
			};

			if (!authResult || !authHeader) {
				return defaultResponse;
			}

			const { authorized, authType } = authResult;
			return {
				...defaultResponse,
				authorized,
				authType,
			};
		},
	);
