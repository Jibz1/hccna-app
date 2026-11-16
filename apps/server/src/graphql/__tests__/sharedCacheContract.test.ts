import { SHARED_RESPONSE_CACHE_QUERY_FIELDS } from "@/graphql/sharedResponseCachePolicy";
import { describe, expect, it } from "bun:test";

import stellateConfig from "../../../stellate";

/**
 * Contract test linking the two independently-maintained public-cache allowlists:
 * - SHARED_RESPONSE_CACHE_QUERY_FIELDS: Query fields cached in-process under one
 *   shared session id (no auth keying) by the Yoga response cache.
 * - stellate.ts rules: Query fields cached publicly at the Stellate edge.
 *
 * Both lists mean "this field is fully public". If they diverge, a field is either
 * edge-cached without being session-shareable (stale-auth risk at the edge) or
 * shared in-process while the edge treats it as private (cache-efficiency bug).
 * Field-specific pins (e.g. Query.castrStream) live in responseCache.test.ts.
 */
describe("shared response cache / Stellate edge cache contract", () => {
	const rules = stellateConfig.config.rules ?? [];
	const stellateQueryFields = new Set(
		rules.flatMap((rule) => {
			if (!rule.types || Array.isArray(rule.types)) {
				return [];
			}
			const queryFields = rule.types.Query;
			return Array.isArray(queryFields) ? queryFields : [];
		}),
	);

	it("edge-cached Query fields exactly match the shared-session allowlist", () => {
		expect([...stellateQueryFields].toSorted()).toEqual(
			[...SHARED_RESPONSE_CACHE_QUERY_FIELDS].toSorted(),
		);
	});
});
