import { CmsContent } from "@/effect/services/cms/content/CmsContent";
import {
	StrapiStreamAclProvider,
	StrapiStreamAclProviderLive,
	type StreamAclRecord,
} from "@/effect/services/StrapiStreamAclProvider";
import { describe, expect, it, mock } from "bun:test";
import { Effect, Layer } from "effect";

import type { CmsStreamAcl } from "@hccnj/strapi-v2";

/** Loads `campusSlug` through a CMS whose ACL record is `acl`, recording the slugs it was asked for. */
const runLoad = async (
	campusSlug: string,
	acl: CmsStreamAcl,
): Promise<{ readonly record: StreamAclRecord; readonly slugs: readonly string[] }> => {
	const streamAcl = mock((_slug: string) => Effect.succeed(acl));
	const contentLayer = Layer.succeed(CmsContent, { streamAcl } as never);
	const providerLayer = StrapiStreamAclProviderLive.pipe(Layer.provide(contentLayer));
	const program = Effect.gen(function* () {
		const provider = yield* StrapiStreamAclProvider;
		return yield* provider.loadFreshBySlug(campusSlug);
	}).pipe(Effect.provide(providerLayer));

	const record = await Effect.runPromise(program);
	return { record, slugs: streamAcl.mock.calls.map(([slug]) => slug) };
};

/** Loads a slug whose CMS ACL record is `acl` and resolves to the provider's error. */
const loadFailure = (acl: CmsStreamAcl | null) => {
	const contentLayer = Layer.succeed(CmsContent, { streamAcl: () => Effect.succeed(acl) } as never);
	const providerLayer = StrapiStreamAclProviderLive.pipe(Layer.provide(contentLayer));
	const program = Effect.gen(function* () {
		const provider = yield* StrapiStreamAclProvider;
		return yield* provider.loadFreshBySlug("house-of-stars");
	}).pipe(Effect.flip, Effect.provide(providerLayer));

	return Effect.runPromise(program);
};

describe("StrapiStreamAclProvider", () => {
	it("loads a campus slug's ACL record and normalizes coordinators", async () => {
		const { record, slugs } = await runLoad("house-of-stars", {
			streamId: "stream-123",
			coordinators: [
				{ email: "  Coord@Example.COM ", excludesIds: "platform-2, platform-2 ,,  platform-3" },
				{ email: null, excludesIds: "ignored" },
			],
		});

		expect(slugs).toEqual(["house-of-stars"]);
		expect(record.streamId).toBe("stream-123");
		expect(record.campusSlug).toBe("house-of-stars");
		// Rows without an email are dropped; emails are trimmed + lowercased;
		// excludesIds are split, trimmed, emptied entries removed, deduplicated.
		expect(record.coordinators).toHaveLength(1);
		expect(record.coordinators[0]?.normalizedEmail).toBe("coord@example.com");
		expect([...(record.coordinators[0]?.excludedPlatformIds ?? [])].toSorted()).toEqual([
			"platform-2",
			"platform-3",
		]);
		expect(record.coordinators[0]?.canEditMetadata).toBe(true);
	});

	it("fails closed when the ACL record's stream id is empty or null", async () => {
		// An empty Castr ID and an unset one are both "no stream".
		const coordinators = [{ email: "coord@example.com", excludesIds: null }];
		const missingStream = { _tag: "StreamAclMissingStreamError", campusSlug: "house-of-stars" };

		expect(await loadFailure({ streamId: "", coordinators })).toMatchObject(missingStream);
		expect(await loadFailure({ streamId: null, coordinators })).toMatchObject(missingStream);
	});
});
