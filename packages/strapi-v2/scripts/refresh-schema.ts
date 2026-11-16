/**
 * Records the Strapi 5 GraphQL schema so tests can validate every query document.
 * Usage (from the repo root):
 *   CMS_V5_ENDPOINT=https://cms.hccna.church/graphql CMS_V5_TOKEN=<read-only Strapi 5 API token> \
 *   bun run --cwd packages/strapi-v2 refresh-schema
 */
import { buildClientSchema, getIntrospectionQuery, printSchema } from "graphql";

import type { IntrospectionQuery } from "graphql";

const endpoint = Bun.env["CMS_V5_ENDPOINT"];
const token = Bun.env["CMS_V5_TOKEN"];
if (!endpoint || !token) {
	throw new Error("Set CMS_V5_ENDPOINT and CMS_V5_TOKEN");
}

const response = await fetch(endpoint, {
	method: "POST",
	headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
	body: JSON.stringify({ query: getIntrospectionQuery() }),
});
if (!response.ok) {
	throw new Error(`Introspection failed: ${response.status} ${response.statusText}`);
}
const { data } = (await response.json()) as { data: IntrospectionQuery };
const sdl = printSchema(buildClientSchema(data));
await Bun.write(new URL("../tests/fixtures/strapi5.graphql", import.meta.url), `${sdl}\n`);
console.log(`Wrote ${sdl.length} bytes of Strapi 5 schema`);
