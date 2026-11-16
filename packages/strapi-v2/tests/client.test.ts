import { describe, expect, it } from "bun:test";
import { Effect } from "effect";

import { createStrapiV2Client } from "../src/client";

import type { StrapiV2FetchFn } from "../src/transport";

const config = { endpoint: "https://cms.example.test/graphql", token: "t" };

const respondWith = (dataByOperation: Readonly<Record<string, object>>) => {
	const requests: Array<{ operation: string; variables: object }> = [];
	const fetch: StrapiV2FetchFn = (_url, init, operation) => {
		requests.push({ operation, variables: JSON.parse(init.body).variables });
		return Effect.succeed(new Response(JSON.stringify({ data: dataByOperation[operation] })));
	};
	return { fetch, requests };
};

describe("createStrapiV2Client", () => {
	it("routes special stream slugs to the stream channels query", async () => {
		const { fetch, requests } = respondWith({
			StrapiV2StreamChannels: { stream: { StreamChannel: [{ ChannelName: "HCC JUNIOR CHURCH", CastrID: "c1", CoordinatorEmails: [] }] } },
		});

		const acl = await Effect.runPromise(createStrapiV2Client(config, fetch).streamAcl("house-of-stars-junior-church"));

		expect(acl).toEqual({ streamId: "c1", coordinators: [] });
		expect(requests).toEqual([{ operation: "StrapiV2StreamChannels", variables: {} }]);
	});

	it("routes campus slugs to the campus stream query", async () => {
		const { fetch, requests } = respondWith({ StrapiV2CampusStream: { campuses: [] } });

		const acl = await Effect.runPromise(createStrapiV2Client(config, fetch).streamAcl("light-house"));

		expect(acl).toBeNull();
		expect(requests).toEqual([{ operation: "StrapiV2CampusStream", variables: { slug: "light-house" } }]);
	});

	it("reports unsupported rich text as a Decode error", async () => {
		const { fetch } = respondWith({
			StrapiV2Campuses: {
				campuses: [
					{
						slug: "x", CampusName: null, Phone: null, Address: null, CityState: null, FacebookChannelLink: null,
						InstagramChannelLink: null, LiveStreamChannelLink: null, Header: null, Stream: null, GivingPlatforms: null,
						leaderships: [], body: { type: "doc", content: [{ type: "mysteryWidget" }] },
					},
				],
			},
		});

		const error = await Effect.runPromise(Effect.flip(createStrapiV2Client(config, fetch).campuses));

		expect(error.reason).toBe("Decode");
		expect(error.operation).toBe("StrapiV2Campuses");
		expect(error.detail).toContain("mysteryWidget");
	});

	it("sends event filter variables", async () => {
		const { fetch, requests } = respondWith({ StrapiV2Events: { events: [] } });

		await Effect.runPromise(createStrapiV2Client(config, fetch).events({ campusSlug: "light-house", slug: "summit-conference" }));

		expect(requests[0]?.variables).toEqual({
			filters: { and: [{ campuses: { slug: { eq: "light-house" } } }, { slug: { eq: "summit-conference" } }] },
			sort: [],
		});
	});
});
