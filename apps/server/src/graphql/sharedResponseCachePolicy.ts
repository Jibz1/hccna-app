/**
 * Policy for the shared (unauthenticated) GraphQL response cache: which operations are
 * eligible, which invalidate it, and the session segment derivation. "Session" in the
 * export names below is the vocabulary of `@graphql-yoga/plugin-response-cache`'s
 * `session` option — keep those names aligned with the plugin, not with this file name.
 */
import { Predicate } from "effect";
import {
	getOperationAST,
	Kind,
	parse,
	type DocumentNode,
	type FragmentDefinitionNode,
	type SelectionNode,
} from "graphql";

import type { Plugin } from "graphql-yoga";

/**
 * Query root fields that are safe to cache under one shared session id (no auth header).
 * Keep in sync with fully public CMS-style operations only — when in doubt, omit a field
 * so it stays per-authorization keyed.
 */
export const SHARED_RESPONSE_CACHE_QUERY_FIELDS: ReadonlySet<string> = new Set([
	"campuses",
	"campusesV2",
	"ccbForms",
	"ccbFormsV2",
	"core",
	"events",
	"home",
	"featuredEvents",
	"sermons",
	"thoughtOfGod",
	"verseOfTheDay",
	"verseOfTheDayV2",
]);

const requestMayUseResponseCache = new WeakMap<Request, boolean>();
const requestMayInvalidateResponseCache = new WeakMap<Request, boolean>();
const requestUsesSharedResponseCache = new WeakMap<Request, boolean>();
const requestDocuments = new WeakMap<Request, DocumentNode>();

/** The document this plugin parsed from the request's params, for plugins that run after it. */
export const getParsedRequestDocument = (request: Request): DocumentNode | undefined =>
	requestDocuments.get(request);

function tryParseDocument(source: string): DocumentNode | null {
	try {
		return parse(source);
	} catch {
		return null;
	}
}

interface CollectQueryRootFieldsState {
	fragments: ReadonlyMap<string, FragmentDefinitionNode>;
	acc: Set<string>;
	visitedFragmentNames: Set<string>;
}

function collectRootFieldsFromSelections(
	selections: readonly SelectionNode[],
	state: CollectQueryRootFieldsState,
): void {
	for (const sel of selections) {
		if (sel.kind === Kind.FIELD) {
			if (sel.name.value !== "__typename") {
				state.acc.add(sel.name.value);
			}
		} else if (sel.kind === Kind.INLINE_FRAGMENT) {
			collectRootFieldsFromSelections(sel.selectionSet.selections, state);
		} else if (sel.kind === Kind.FRAGMENT_SPREAD) {
			const fragmentName = sel.name.value;
			if (!state.visitedFragmentNames.has(fragmentName)) {
				state.visitedFragmentNames.add(fragmentName);
				const frag = state.fragments.get(fragmentName);
				if (frag) {
					collectRootFieldsFromSelections(frag.selectionSet.selections, state);
				}
			}
		}
	}
}

/**
 * Returns true when the operation only selects shared-public Query fields (whitelist).
 * Any other root field forces per-session cache keying.
 */
export function queryUsesOnlySharedCacheFields(
	document: DocumentNode,
	operationName: string | null | undefined,
): boolean {
	const op = getOperationAST(document, operationName ?? undefined);
	if (!op || op.operation !== "query") {
		return false;
	}

	const fragments = new Map<string, FragmentDefinitionNode>();
	for (const def of document.definitions) {
		if (def.kind === Kind.FRAGMENT_DEFINITION) {
			fragments.set(def.name.value, def);
		}
	}

	const rootFields = new Set<string>();
	collectRootFieldsFromSelections(op.selectionSet.selections, {
		fragments,
		acc: rootFields,
		visitedFragmentNames: new Set<string>(),
	});

	if (rootFields.size === 0) {
		return false;
	}

	for (const name of rootFields) {
		if (!SHARED_RESPONSE_CACHE_QUERY_FIELDS.has(name)) {
			return false;
		}
	}

	return true;
}

/**
 * Response caching is only valid for query operations. Mutations can be
 * personalized, side-effectful, and time-sensitive even when their result shape
 * looks cacheable to the generic response-cache plugin.
 */
function operationMayUseResponseCache(
	document: DocumentNode,
	operationName: string | null | undefined,
): boolean {
	const op = getOperationAST(document, operationName ?? undefined);
	return op?.operation === "query";
}

/**
 * Mutation executions must keep the response-cache plugin enabled so
 * `invalidateViaMutation` can clear cached query entries, but they should not
 * participate in response-cache lookup/write during Yoga params handling.
 */
function operationMayInvalidateResponseCache(
	document: DocumentNode,
	operationName: string | null | undefined,
): boolean {
	const op = getOperationAST(document, operationName ?? undefined);
	return op?.operation === "mutation";
}

function isGraphQLExecutionContext<Input>(context: Input): context is Input & { effect: unknown } {
	return Predicate.isObject(context) && Predicate.hasProperty(context, "effect");
}

/**
 * Runs before `useResponseCache` and records whether this HTTP request may use
 * response caching and whether it should use a shared cache session.
 */
export function useMarkGraphQLSharedResponseCacheRequests(): Plugin {
	return {
		onParams({ params, request }) {
			if (!params.query || !Predicate.isString(params.query)) {
				requestMayUseResponseCache.set(request, false);
				requestMayInvalidateResponseCache.set(request, false);
				requestUsesSharedResponseCache.set(request, false);
				return;
			}

			const document = tryParseDocument(params.query);
			if (!document) {
				requestMayUseResponseCache.set(request, false);
				requestMayInvalidateResponseCache.set(request, false);
				requestUsesSharedResponseCache.set(request, false);
				return;
			}
			requestDocuments.set(request, document);

			const cacheEnabled = operationMayUseResponseCache(document, params.operationName);
			const invalidationEnabled = operationMayInvalidateResponseCache(
				document,
				params.operationName,
			);
			requestMayUseResponseCache.set(request, cacheEnabled);
			requestMayInvalidateResponseCache.set(request, invalidationEnabled);

			if (!cacheEnabled) {
				requestUsesSharedResponseCache.set(request, false);
				return;
			}

			const shared = queryUsesOnlySharedCacheFields(document, params.operationName);
			requestUsesSharedResponseCache.set(request, shared);
		},
	};
}

/**
 * Response-cache plugin enablement. This gate prevents mutation results from
 * being read from or written to the GraphQL response cache.
 */
export function getGraphQLResponseCacheEnabled<ContextValue>(
	request: Request,
	context?: ContextValue,
): boolean {
	if (
		isGraphQLExecutionContext(context) &&
		requestMayInvalidateResponseCache.get(request) === true
	) {
		return true;
	}

	return requestMayUseResponseCache.get(request) === true;
}

/**
 * Session segment for @graphql-yoga/plugin-response-cache.
 * - `null` shares cache entries across clients for whitelist-only operations.
 * - Otherwise uses Authorization so user-specific operations stay isolated.
 */
export function getGraphQLResponseCacheSessionId(request: Request): string | null {
	if (requestUsesSharedResponseCache.get(request) === true) {
		return null;
	}
	return request.headers.get("authorization");
}
