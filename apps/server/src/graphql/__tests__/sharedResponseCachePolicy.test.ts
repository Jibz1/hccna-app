import { describe, expect, it } from "bun:test";
import { parse } from "graphql";

import { queryUsesOnlySharedCacheFields } from "../sharedResponseCachePolicy";

describe("queryUsesOnlySharedCacheFields", () => {
	it("returns false when a private root field is selected", () => {
		const doc = parse(`
			query Mixed {
				home { featuredEvents { events { eventTitle } } }
				user { __typename }
			}
		`);
		expect(queryUsesOnlySharedCacheFields(doc, "Mixed")).toBe(false);
	});

	it("follows fragment spreads on the root selection", () => {
		const doc = parse(`
			query Q {
				...HomeFrag
			}
			fragment HomeFrag on Query {
				core { giving { copy } }
			}
		`);
		expect(queryUsesOnlySharedCacheFields(doc, "Q")).toBe(true);
	});
});
