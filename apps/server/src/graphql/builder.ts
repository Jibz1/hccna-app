import { db } from "@/db";
import { relations } from "@/db/relations";
import { loadAppConfigSync } from "@/effect/AppConfig";
import { getPath } from "@/graphql/pathContext";
import { sanitizeTelemetryData } from "@/platform/observability/redaction";
import { getLogger } from "@/transport/http/pinoLoggerMiddleware";
import SchemaBuilder from "@pothos/core";
import DirectivePlugin from "@pothos/plugin-directives";
import DrizzlePlugin from "@pothos/plugin-drizzle";
import ErrorPlugin from "@pothos/plugin-errors";
import RelayPlugin from "@pothos/plugin-relay";
import ScopeAuthPlugin from "@pothos/plugin-scope-auth";
import SimpleObjectsPlugin from "@pothos/plugin-simple-objects";
import TracingPlugin, {
	isEnumField,
	isExposedField,
	isRootField,
	isScalarField,
	wrapResolver,
} from "@pothos/plugin-tracing";
import WithInputPlugin from "@pothos/plugin-with-input";
import { createSentryWrapper } from "@pothos/tracing-sentry";
import { getTableConfig } from "drizzle-orm/pg-core";
import { DateTimeResolver, JSONResolver, URLResolver } from "graphql-scalars";

import {
	isClientAuthType,
	type AuthorizedAuthContext,
	type ClientAuthContext,
	type FirebaseAnonymousAuthContext,
	type GoogleIamAuthContext,
	type GoogleInternalAuthContext,
	type GraphQLAuthScopes,
	type JwtAuthContext,
	type SignedInAuthContext,
	type TokenAuthContext,
	type FirebaseClientAuthContext,
} from "./auth-model";

import type { GraphQLContext } from "./context";

const appConfig = loadAppConfigSync();

/**
 * Shared Pothos builder for the GraphQL schema.
 * Plugin order matters because schema modules rely on these capabilities.
 */
// Arguments stay out of spans: they carry emails, one-time sign-in codes and push tokens, and
// span attributes skip the redaction that logs and error events go through. The printed source
// is left out for the same reason: it includes any argument a caller wrote as a literal.
const wrapWithSentry = createSentryWrapper({
	includeArgs: false,
	includeSource: false,
});

interface PothosTypes {
	Scalars: {
		DateTime: {
			Input: Date;
			Output: Date | string | number;
		};
		URL: {
			Input: URL;
			Output: URL | string;
		};
		JSON: {
			Input: unknown;
			Output: unknown;
		};
	};

	Context: GraphQLContext;
	AuthContexts: {
		firebaseClient: FirebaseClientAuthContext<GraphQLContext>;
		signedIn: SignedInAuthContext<GraphQLContext>;
		authorized: AuthorizedAuthContext<GraphQLContext>;
		jwtAuth: JwtAuthContext<GraphQLContext>;
		tokenAuth: TokenAuthContext<GraphQLContext>;
		firebaseAnonymous: FirebaseAnonymousAuthContext<GraphQLContext>;
		clientAuth: ClientAuthContext<GraphQLContext>;
		googleInternal: GoogleInternalAuthContext<GraphQLContext>;
		googleIam: GoogleIamAuthContext<GraphQLContext>;
	};
	AuthScopes: GraphQLAuthScopes;
	DrizzleRelations: typeof relations;
}

export const builder = new SchemaBuilder<PothosTypes>({
	plugins: [
		RelayPlugin,
		ScopeAuthPlugin,
		ErrorPlugin,
		TracingPlugin,
		DirectivePlugin,
		SimpleObjectsPlugin,
		WithInputPlugin,
		DrizzlePlugin,
	],
	drizzle: {
		client: db,
		getTableConfig,
		relations,
	},
	errors: {},
	scopeAuth: {
		// Centralize auth scope derivation for schema modules.
		authScopes: (context) => ({
			firebaseClient:
				Boolean(context.currentUserUid) &&
				(context.authType === "jwt" || context.authType === "firebaseAnonymous"),
			signedIn:
				context.authType === "jwt" &&
				Boolean(context.currentUserUid) &&
				Boolean(context.currentUserEmail),
			authorized: context.authorized,
			jwtAuth: context.authType === "jwt",
			tokenAuth: context.authType === "token",
			firebaseAnonymous: context.authType === "firebaseAnonymous",
			clientAuth: isClientAuthType(context.authType),
			googleInternal: context.authType === "googleInternal",
			googleIam: context.authType === "googleIam",
		}),
		cacheKey: (val) => JSON.stringify(val),
	},
	tracing: {
		default: (config) =>
			isRootField(config) ||
			(!appConfig.isProduction &&
				!isScalarField(config) &&
				!isEnumField(config) &&
				!isExposedField(config)),
		// oxlint-disable-next-line
		wrap: (resolver, options) => {
			// oxlint-disable-next-line max-params
			return (parent, args, context, info) => {
				const traced = wrapWithSentry(resolver, options);
				const wrapped = wrapResolver(traced, (error) => {
					if (error) {
						getLogger()
							.child({
								// Keep resolver context on the log entry for trace correlation.
								gqlOperationName: info.operation.name?.value,
								gqlPath: getPath(info),
								gqlResolverArgs: JSON.stringify(
									sanitizeTelemetryData(JSON.parse(JSON.stringify(args))),
								),
								gqlVariables: JSON.stringify(
									sanitizeTelemetryData(JSON.parse(JSON.stringify(info.variableValues))),
								),
							})
							.error(error);
					}
				});
				return wrapped(parent, args, context, info);
			};
		},
	},
});

// type BuilderSchemaTypes = typeof builder.$inferSchemaTypes;

// Register shared scalars once so schema modules can reference them by name.
builder.addScalarType("DateTime", DateTimeResolver);
builder.addScalarType("URL", URLResolver);
builder.addScalarType("JSON", JSONResolver);
builder.queryType({});
builder.mutationType({});
