import { describe, expect, it } from "bun:test";
import { Effect, Schema } from "effect";

import { makeTransport, type StrapiV2FetchFn, type StrapiV2RequestInit } from "../src/transport";

const config = { endpoint: "https://cms.example.test/graphql", token: "test-token" };
const Ping = Schema.Struct({ ping: Schema.String });

const json = (body: object, status = 200) =>
	new Response(JSON.stringify(body), { status, statusText: status === 200 ? "OK" : "Error" });

const queued = (responses: Array<Response | Error>) => {
	const calls: Array<{ url: string; init: StrapiV2RequestInit; operation: string }> = [];
	const fetch: StrapiV2FetchFn = (url, init, operation) => {
		calls.push({ url, init, operation });
		const next = responses.shift();
		if (next === undefined) {
			return Effect.fail(new Error("no response queued"));
		}
		return next instanceof Error ? Effect.fail(next) : Effect.succeed(next);
	};
	return { fetch, calls };
};

const ping = (fetch: StrapiV2FetchFn) =>
	makeTransport(config, fetch).query("Ping", "query Ping { ping }", { a: 1 }, Ping);

describe("Strapi 5 transport", () => {
	it("posts the named operation with a bearer token and decodes data", async () => {
		const { fetch, calls } = queued([json({ data: { ping: "pong" } })]);

		const result = await Effect.runPromise(ping(fetch));

		expect(result).toEqual({ ping: "pong" });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(config.endpoint);
		expect(calls[0]?.operation).toBe("Ping");
		expect(calls[0]?.init.method).toBe("POST");
		expect(calls[0]?.init.timeout).toBe(4000);
		expect(calls[0]?.init.headers["Authorization"]).toBe("Bearer test-token");
		expect(JSON.parse(calls[0]?.init.body ?? "{}")).toEqual({
			operationName: "Ping",
			query: "query Ping { ping }",
			variables: { a: 1 },
		});
	});

	it("asks the CMS to skip its response cache on every attempt", async () => {
		const { fetch, calls } = queued([json({}, 503), json({ data: { ping: "pong" } })]);

		await Effect.runPromise(ping(fetch));

		// HCCNJ/site's strapi-cache plugin neither reads nor writes its cache for a no-cache request.
		expect(calls.map((call) => call.init.headers["Cache-Control"])).toEqual(["no-cache", "no-cache"]);
	});

	it("retries a 503 and succeeds", async () => {
		const { fetch, calls } = queued([json({}, 503), json({ data: { ping: "pong" } })]);

		const result = await Effect.runPromise(ping(fetch));

		expect(result).toEqual({ ping: "pong" });
		expect(calls).toHaveLength(2);
	});

	it("does not retry a 401", async () => {
		const { fetch, calls } = queued([json({}, 401)]);

		const error = await Effect.runPromise(Effect.flip(ping(fetch)));

		expect(error.reason).toBe("Status");
		expect(error.status).toBe(401);
		expect(calls).toHaveLength(1);
	});

	it("keeps Strapi's GraphQL messages from a 400 without retrying", async () => {
		const { fetch, calls } = queued([
			new Response(JSON.stringify({ errors: [{ message: 'Cannot query field "x" on type "Campus".' }] }), {
				status: 400,
				statusText: "Bad Request",
			}),
		]);

		const error = await Effect.runPromise(Effect.flip(ping(fetch)));

		expect(error.reason).toBe("Status");
		expect(error.status).toBe(400);
		expect(error.detail).toBe('Strapi 5 responded 400 Bad Request: Cannot query field "x" on type "Campus".');
		expect(calls).toHaveLength(1);
	});

	it("retries a 503 with a non-JSON body and reports only its status", async () => {
		const unavailable = () =>
			new Response("<html>upstream unavailable</html>", { status: 503, statusText: "Service Unavailable" });
		const { fetch, calls } = queued([unavailable(), unavailable(), unavailable()]);

		const error = await Effect.runPromise(Effect.flip(ping(fetch)));

		expect(error.reason).toBe("Status");
		expect(error.status).toBe(503);
		expect(error.detail).toBe("Strapi 5 responded 503 Service Unavailable");
		expect(calls).toHaveLength(3);
	});

	it("reads only the first 2 KB of an error body", async () => {
		const kilobyte = new TextEncoder().encode("x".repeat(1024));
		let pulled = 0;
		const large = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled += 1;
				controller.enqueue(kilobyte);
				if (pulled === 100) {
					controller.close();
				}
			},
		});
		const { fetch, calls } = queued([new Response(large, { status: 400, statusText: "Bad Request" })]);

		const error = await Effect.runPromise(Effect.flip(ping(fetch)));

		expect(error.detail).toBe("Strapi 5 responded 400 Bad Request");
		expect(pulled).toBeLessThan(5);
		expect(calls).toHaveLength(1);
	});

	it("keeps the status detail when an error body fails mid-read", async () => {
		const broken = new ReadableStream({
			start(controller) {
				controller.error(new Error("reset"));
			},
		});
		const { fetch, calls } = queued([new Response(broken, { status: 401, statusText: "Unauthorized" })]);

		const error = await Effect.runPromise(Effect.flip(ping(fetch)));

		expect(error.reason).toBe("Status");
		expect(error.detail).toBe("Strapi 5 responded 401 Unauthorized");
		expect(calls).toHaveLength(1);
	});

	it("fails with GraphQL errors without retrying", async () => {
		const { fetch, calls } = queued([json({ data: null, errors: [{ message: "Forbidden access" }] })]);

		const error = await Effect.runPromise(Effect.flip(ping(fetch)));

		expect(error.reason).toBe("GraphQL");
		expect(error.detail).toContain("Forbidden access");
		expect(calls).toHaveLength(1);
	});

	it("fails with Decode when data does not match the Schema", async () => {
		const { fetch, calls } = queued([json({ data: { ping: 42 } })]);

		const error = await Effect.runPromise(Effect.flip(ping(fetch)));

		expect(error.reason).toBe("Decode");
		expect(error.operation).toBe("Ping");
		expect(calls).toHaveLength(1);
	});

	it("retries transport failures twice, then fails", async () => {
		const { fetch, calls } = queued([new Error("reset"), new Error("reset"), new Error("reset")]);

		const error = await Effect.runPromise(Effect.flip(ping(fetch)));

		expect(error.reason).toBe("Transport");
		expect(calls).toHaveLength(3);
	});

	it("retries a body that fails mid-read", async () => {
		const { fetch, calls } = queued([
			new Response(new ReadableStream({ start(controller) { controller.error(new Error("reset")); } }), { status: 200 }),
			new Response(new ReadableStream({ start(controller) { controller.error(new Error("reset")); } }), { status: 200 }),
			new Response(new ReadableStream({ start(controller) { controller.error(new Error("reset")); } }), { status: 200 }),
		]);

		const error = await Effect.runPromise(Effect.flip(ping(fetch)));

		expect(error.reason).toBe("Transport");
		expect(calls).toHaveLength(3);
	});

	it("fails with Decode on a non-JSON body without retrying", async () => {
		const { fetch, calls } = queued([new Response("not json", { status: 200 })]);

		const error = await Effect.runPromise(Effect.flip(ping(fetch)));

		expect(error.reason).toBe("Decode");
		expect(calls).toHaveLength(1);
	});
});
