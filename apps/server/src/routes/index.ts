import { buildRequestContext, RequestContext } from "@/effect/RequestContext";
import { registerGraphQLRoute } from "@/routes/graphql";
import { getV1WebHandler } from "@/routes/v1";
import { Context } from "effect";

import type { OpenAPIHono } from "@hono/zod-openapi";

export async function registerGraphQLRoutes(app: OpenAPIHono) {
	await registerGraphQLRoute(app);
}

export function registerVersionedRoutes(app: OpenAPIHono) {
	const { handler } = getV1WebHandler();

	// Endpoint paths are declared with the /v1 prefix, so the raw request URL
	// can be handed to the HttpApi router unchanged.
	app.all("/v1/*", (c) => handler(c.req.raw, Context.make(RequestContext, buildRequestContext(c))));
}
