import schemaSource from "@hccnj/schema/schema.graphql?raw";
import { buildSchema, parse, validate } from "graphql";
import { describe, expect, test } from "vitest";

/**
 * Validates the checked-out app's operations against the selected schema.
 *
 * Relay sends each artifact's `params.text` verbatim, so the committed
 * artifacts — not the `graphql` tags in source — are the wire contract. Run
 * offline and in PRs this uses the proposed schema. PR CI separately rejects
 * backward-incompatible changes to the deployed API. Scheduled/manual CI runs
 * download production's schema first to verify mobile release readiness.
 */

type RelayArtifact = {
  kind?: string;
  params?: { text?: string | null };
};

const artifacts = import.meta.glob<{ default?: RelayArtifact }>(
  "../**/__generated__/*.graphql.ts",
  { eager: true },
);

const schema = buildSchema(schemaSource);

describe("mobile GraphQL operations", () => {
  test("finds committed Relay artifacts to validate", () => {
    // Canary: if the glob ever stops matching, the validation below would pass
    // while checking nothing. The app ships ~32 artifacts today.
    expect(Object.keys(artifacts).length).toBeGreaterThan(20);
  });

  test("every operation is valid against the schema", () => {
    const failures: string[] = [];

    for (const [path, artifact] of Object.entries(artifacts)) {
      const node = artifact.default;
      // Fragment artifacts carry no operation text; only operations go on the wire.
      if (node?.kind === "Fragment") {
        continue;
      }

      const text = node?.params?.text;
      // A Request without text (e.g. persisted queries) can't be validated
      // here; fail loudly rather than silently shrinking coverage.
      if (!text) {
        failures.push(`${path}\n    Request artifact has no operation text`);
        continue;
      }

      const errors = validate(schema, parse(text));
      if (errors.length > 0) {
        failures.push(
          `${path}\n    ${errors.map((error) => error.message).join("\n    ")}`,
        );
      }
    }

    expect(
      failures,
      `Operations invalid against schema.graphql:\n  ${failures.join("\n  ")}`,
    ).toEqual([]);
  });
});
