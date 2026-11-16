import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  buildClientSchema,
  buildSchema,
  findBreakingChanges,
  getIntrospectionQuery,
  printSchema,
} from "graphql";

import { APPS_BACKEND_URL } from "../src/utils/constants";

// Overridable so CI (or a local backend) can be pointed at a different origin.
const baseUrl = process.env.GRAPHQL_SCHEMA_URL ?? APPS_BACKEND_URL;
const url = `${baseUrl}/graphql`;
const filePath =
  process.env.GRAPHQL_SCHEMA_PATH ??
  fileURLToPath(import.meta.resolve("@hccnj/schema/schema.graphql"));

async function main() {
  const mode = process.argv[2] ?? "--download";
  if (
    (mode !== "--download" && mode !== "--check-compatibility") ||
    process.argv.length > 3
  ) {
    throw new Error("Expected --download or --check-compatibility");
  }
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: getIntrospectionQuery(),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Introspection failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(
      `Introspection returned errors: ${JSON.stringify(data.errors)}`,
    );
  }

  const schema = buildClientSchema(data.data);
  if (mode === "--check-compatibility") {
    const proposed = buildSchema(await readFile(filePath, "utf8"));
    const breaking = findBreakingChanges(schema, proposed);
    if (breaking.length > 0) {
      throw new Error(
        `Proposed schema breaks the deployed API:\n${breaking
          .map((change) => `- ${change.description}`)
          .join("\n")}`,
      );
    }
    console.log(`Proposed schema preserves the deployed API at ${url}`);
    return;
  }
  const sdl = printSchema(schema);
  await writeFile(filePath, sdl);

  console.log(`Schema written to ${filePath} from ${url}`);
}

// Exit non-zero on failure: a swallowed error would leave the previous
// schema.graphql in place, and any check running against it would pass while
// validating nothing.
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
