import { useDeferStream } from "@graphql-yoga/plugin-defer-stream";
import { printSchema } from "graphql";
import { createYoga } from "graphql-yoga";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { schema } from "./schema";

const SCHEMA_PATH = fileURLToPath(import.meta.resolve("@hccnj/schema/schema.graphql"));

export function emitSchema(): string {
	// Yoga adds directives to the public schema after Pothos builds it. Export
	// that contract too, so offline validation sees the same API as clients.
	const { schema: publicSchema } = createYoga({
		schema,
		plugins: [useDeferStream()],
		logging: false,
	}).getEnveloped({});
	writeFileSync(SCHEMA_PATH, printSchema(publicSchema));
	return SCHEMA_PATH;
}
