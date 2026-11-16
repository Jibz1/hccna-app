import { describe, expect, it } from "bun:test";
import { parse } from "graphql";

import stellateConfig from "../../../stellate";
import { responseCacheTtlPerSchemaCoordinate } from "../responseCache";
import { queryUsesOnlySharedCacheFields } from "../sharedResponseCachePolicy";

/**
 * Regression pins for `Query.castrStream` caching, per
 * docs/streaming-migration-implementation-v3.md ("Caching and invalidation").
 *
 * The resolver performs a source-fresh Strapi authorization read on every
 * request; any cache layer that can serve the field without running the
 * resolver would keep serving revoked platform visibility and stream keys.
 * These tests pin all three layers where that could happen.
 */
describe("castrStream cache pins", () => {
	it("has a response-cache TTL of exactly 0", () => {
		expect(responseCacheTtlPerSchemaCoordinate["Query.castrStream"]).toBe(0);
	});

	it("is never eligible for the shared response-cache session", () => {
		const doc = parse(`
			query CastrStream {
				castrStream(campusSlug: "house-of-stars") {
					id
					platforms { id stream_key }
				}
			}
		`);
		expect(queryUsesOnlySharedCacheFields(doc, "CastrStream")).toBe(false);
	});

	it("is absent from the Stellate edge-cache rules", () => {
		const cachedQueryFields = (stellateConfig.config.rules ?? []).flatMap((rule) => {
			const queryTypes = (rule.types as { Query?: string[] }).Query;
			return queryTypes ?? [];
		});
		expect(cachedQueryFields).not.toContain("castrStream");
		expect(cachedQueryFields.length).toBeGreaterThan(0);
	});
});

describe("liveStreamStatus cache pins", () => {
	it("has a response-cache TTL of exactly 0 so ended streams never read as live", () => {
		expect(responseCacheTtlPerSchemaCoordinate["Query.liveStreamStatus"]).toBe(0);
	});
});
