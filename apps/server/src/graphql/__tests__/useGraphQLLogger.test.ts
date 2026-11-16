import { useMarkGraphQLSharedResponseCacheRequests } from "@/graphql/sharedResponseCachePolicy";
import { useGraphQLLogger } from "@/graphql/useGraphQLLogger";
import { pinoLogger } from "@/transport/http/pinoLoggerMiddleware";
import { useResponseCache } from "@graphql-yoga/plugin-response-cache";
import { describe, expect, it } from "bun:test";
import { createSchema, createYoga } from "graphql-yoga";
import { Hono } from "hono";
// A dedicated Pino sink captures the actual request logs without mocking logging.
// oxlint-disable-next-line no-restricted-imports
import pino from "pino";

// The production plugin order: the cache policy parses the request before the logger reads it.
const appWithRequestLogs = (lines: string[]) => {
	const yoga = createYoga({
		schema: createSchema({
			typeDefs: "type Query { greeting: String broken: String }",
			resolvers: {
				Query: {
					greeting: () => "hello",
					broken: () => {
						throw new Error("resolver failed");
					},
				},
			},
		}),
		plugins: [
			useMarkGraphQLSharedResponseCacheRequests(),
			useGraphQLLogger(),
			useResponseCache({ session: () => null }),
		],
		logging: false,
	});
	const app = new Hono();
	app.use(pinoLogger(pino({ timestamp: false }, { write: (line) => lines.push(line) })));
	app.post("/graphql", (context) => yoga.fetch(context.req.raw));
	return app;
};

const post = (app: Hono, body: string) =>
	app.request("http://localhost/graphql", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body,
	});

const requestLogs = (lines: string[]) =>
	lines.map((line) => JSON.parse(line)).filter((entry) => entry.method);

describe("useGraphQLLogger", () => {
	it("names a cached operation from its document, as the mobile app sends no operationName", async () => {
		const lines: string[] = [];
		const app = appWithRequestLogs(lines);
		// The app posts Relay's non-persisted id (null) and no operationName.
		const body = JSON.stringify({ id: null, query: "query HomeQuery { greeting }", variables: {} });

		await post(app, body);
		await post(app, body);

		expect(
			requestLogs(lines).map(({ operationName, operationType, fields, errorCount }) => ({
				operationName,
				operationType,
				fields,
				errorCount,
			})),
		).toEqual([
			{ operationName: "HomeQuery", operationType: "query", fields: ["greeting"], errorCount: 0 },
			{ operationName: "HomeQuery", operationType: "query", fields: ["greeting"], errorCount: 0 },
		]);
	});

	it("logs a request whose operationName is not a string", async () => {
		const lines: string[] = [];
		const app = appWithRequestLogs(lines);

		// The response cache itself answers this with a 500; the request must still be logged.
		const response = await post(
			app,
			JSON.stringify({ query: "query HomeQuery { greeting }", operationName: { toString: 1 } }),
		);

		expect(requestLogs(lines)).toMatchObject([
			{ status: response.status, operationName: "HomeQuery" },
		]);
	});

	it("counts GraphQL errors in a response that is still HTTP 200", async () => {
		const lines: string[] = [];
		const app = appWithRequestLogs(lines);

		const response = await post(
			app,
			JSON.stringify({ query: "query BrokenQuery { greeting broken }" }),
		);

		expect(response.status).toBe(200);
		expect(requestLogs(lines)).toMatchObject([{ status: 200, errorCount: 1 }]);
	});

	it("counts errors from a request rejected before execution", async () => {
		const lines: string[] = [];
		const app = appWithRequestLogs(lines);

		await post(app, JSON.stringify({ query: "query UnknownQuery { missing }" }));

		expect(requestLogs(lines)).toMatchObject([{ errorCount: 1 }]);
	});
});
