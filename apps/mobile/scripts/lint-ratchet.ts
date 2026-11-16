import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

export const RATCHETED_RULES = [
  "mobile/no-direct-effect",
  "mobile/no-raw-timers",
  "mobile/no-extra-state-library",
  "mobile/no-direct-relay-mutation",
  "mobile/no-direct-feature-gate",
  "mobile/no-direct-auth-listener",
] as const;

/** rule id -> file path relative to apps/mobile (posix, no leading "./") -> violation count */
export type LintBaseline = Readonly<
  Record<string, Readonly<Record<string, number>>>
>;
export type RatchetEntry = {
  readonly rule: string;
  readonly file: string;
  readonly baseline: number;
  readonly actual: number;
};
export type OxlintDiagnostic = {
  readonly code: string;
  readonly filename: string;
};

export type ForbiddenDisable = {
  readonly line: number;
  readonly comment: string;
};

const BASELINE_FILE = "lint-baseline.json";
/**
 * Holds one violation of every ratcheted rule. Oxlint lints it only in the ratchet
 * run; if a rule reports nothing there, the rule or the lint config is broken.
 */
export const CANARY_FILE = "scripts/lint-ratchet.canary.tsx";
const ratcheted: ReadonlySet<string> = new Set(RATCHETED_RULES);

// An `oxlint-disable*` or `eslint-disable*` directive in a line or block comment,
// with the rule list (and any `-- reason`) that follows it.
const LINE_DISABLE =
  /\/\/[ \t]*(?:oxlint|eslint)-disable(?:-next-line|-line)?(?![\w-])[^\n]*/g;
const BLOCK_DISABLE =
  /\/\*\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?(?![\w-])[\s\S]*?\*\//g;
const DIRECTIVE =
  /^(?:\/\/|\/\*)\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?/;

const OxlintOutput = Schema.fromJsonString(
  Schema.Struct({
    diagnostics: Schema.Array(
      Schema.Struct({ code: Schema.String, filename: Schema.String }),
    ),
  }),
);
const BaselineJson = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Number)),
);

function normalizePath(path: string) {
  return path.replace(/^(\.\/)+/, "");
}

function ratchetedRule(code: string) {
  const match = /^mobile\((.+)\)$/.exec(code);
  if (match === null) {
    return undefined;
  }
  const rule = `mobile/${match[1]}`;
  return ratcheted.has(rule) ? rule : undefined;
}

/**
 * Finds disable comments the policy forbids: a blanket one (it names no rule) or one
 * that names any `mobile/` rule. Text inside a string literal counts as a comment.
 */
export function findForbiddenDisables(
  source: string,
): readonly ForbiddenDisable[] {
  const found: { index: number; comment: string }[] = [];
  for (const pattern of [LINE_DISABLE, BLOCK_DISABLE]) {
    for (const match of source.matchAll(pattern)) {
      const comment = match[0].trimEnd();
      const rules = comment
        .replace(DIRECTIVE, "")
        .replace(/\*\/$/, "")
        .split("--")[0]
        .split(/[\s,]+/)
        .filter((rule) => rule !== "");
      if (
        rules.length === 0 ||
        rules.some((rule) => rule.startsWith("mobile/"))
      ) {
        found.push({ index: match.index, comment });
      }
    }
  }
  return found
    .sort((a, b) => a.index - b.index)
    .map(({ index, comment }) => ({
      line: source.slice(0, index).split("\n").length,
      comment,
    }));
}

/** Ratcheted rules with no diagnostic in the canary file, in RATCHETED_RULES order. */
export function missingCanaryRules(
  diagnostics: readonly OxlintDiagnostic[],
): readonly string[] {
  const reporting = new Set(
    diagnostics
      .filter(({ filename }) => normalizePath(filename) === CANARY_FILE)
      .map(({ code }) => ratchetedRule(code)),
  );
  return RATCHETED_RULES.filter((rule) => !reporting.has(rule));
}

/**
 * Counts diagnostics whose code is "mobile(<rule>)" for a ratcheted rule, per file.
 * The canary file's diagnostics are never counted.
 */
export function countViolations(diagnostics: readonly OxlintDiagnostic[]) {
  const counts: Record<string, Record<string, number>> = {};
  for (const { code, filename } of diagnostics) {
    const rule = ratchetedRule(code);
    const file = normalizePath(filename);
    if (rule === undefined || file === CANARY_FILE) {
      continue;
    }
    counts[rule] ??= {};
    const files = counts[rule];
    files[file] = (files[file] ?? 0) + 1;
  }
  return counts;
}

export function compareBaseline(baseline: LintBaseline, actual: LintBaseline) {
  const increased: RatchetEntry[] = [];
  const decreased: RatchetEntry[] = [];
  const rules = new Set([...Object.keys(baseline), ...Object.keys(actual)]);
  for (const rule of [...rules].sort()) {
    const expected = baseline[rule] ?? {};
    const found = actual[rule] ?? {};
    const files = new Set([...Object.keys(expected), ...Object.keys(found)]);
    for (const file of [...files].sort()) {
      const entry = {
        rule,
        file,
        baseline: expected[file] ?? 0,
        actual: found[file] ?? 0,
      };
      if (entry.actual > entry.baseline) {
        increased.push(entry);
      } else if (entry.actual < entry.baseline) {
        decreased.push(entry);
      }
    }
  }
  return { increased, decreased };
}

/** Lowers counts to `actual` and drops files at zero. Never adds a file or raises a count. */
export function lowerBaseline(baseline: LintBaseline, actual: LintBaseline) {
  const lowered: Record<string, Record<string, number>> = {};
  for (const [rule, files] of Object.entries(baseline)) {
    for (const [file, count] of Object.entries(files)) {
      const next = Math.min(count, actual[rule]?.[file] ?? 0);
      if (next > 0) {
        (lowered[rule] ??= {})[file] = next;
      }
    }
  }
  return lowered;
}

function sortedJson(baseline: LintBaseline) {
  const sorted: Record<string, Record<string, number>> = {};
  for (const rule of Object.keys(baseline).sort()) {
    const files: Record<string, number> = {};
    for (const file of Object.keys(baseline[rule] ?? {}).sort()) {
      files[file] = baseline[rule]?.[file] ?? 0;
    }
    sorted[rule] = files;
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

function describe(entry: RatchetEntry) {
  return `  ${entry.rule}  ${entry.file}  baseline ${entry.baseline}, actual ${entry.actual}`;
}

function collectActual(appRoot: string): LintBaseline {
  const result = spawnSync(
    "bunx",
    ["oxlint", "-c", "oxlint.config.mjs", "-f", "json"],
    {
      cwd: appRoot,
      encoding: "utf8",
      env: { ...process.env, MOBILE_LINT_RATCHET: "1" },
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  // Oxlint exits non-zero when it reports errors; only unparseable output is a failure.
  const parsed = Schema.decodeUnknownResult(OxlintOutput)(result.stdout);
  if (parsed._tag === "Failure") {
    console.error("lint-ratchet: could not parse Oxlint JSON output.");
    console.error(result.stderr);
    process.exit(2);
  }
  const { diagnostics } = parsed.success;
  const missing = missingCanaryRules(diagnostics);
  if (missing.length > 0) {
    console.error(`lint-ratchet: no diagnostic in ${CANARY_FILE} for:`);
    for (const rule of missing) {
      console.error(`  ${rule}`);
    }
    console.error(
      "These rules are not reporting: the rule or the lint config is broken. The baseline was not changed.",
    );
    process.exit(2);
  }
  return countViolations(diagnostics);
}

/** Every linted .ts/.tsx file under src, relative to apps/mobile (generated code excluded). */
function listLintedSources(appRoot: string): readonly string[] {
  return readdirSync(join(appRoot, "src"), {
    recursive: true,
    encoding: "utf8",
  })
    .filter(
      (path) =>
        /\.tsx?$/.test(path) &&
        !path.endsWith(".d.ts") &&
        !path.split(sep).includes("__generated__"),
    )
    .map((path) => join("src", path).split(sep).join("/"))
    .sort();
}

function failOnForbiddenDisables(appRoot: string) {
  const found = listLintedSources(appRoot).flatMap((file) =>
    findForbiddenDisables(readFileSync(join(appRoot, file), "utf8")).map(
      (disable) => ({ file, ...disable }),
    ),
  );
  if (found.length === 0) {
    return;
  }
  console.error("lint-ratchet: forbidden disable comments:");
  for (const { file, line, comment } of found) {
    console.error(`  ${file}:${line}  ${comment}`);
  }
  console.error(
    'The mobile/ rules may not be disabled, and a disable comment must name the rules it turns off. See "Effects, timers and guarded imports" in apps/mobile/AGENTS.md.',
  );
  process.exit(1);
}

function readBaseline(path: string): LintBaseline {
  if (!existsSync(path)) {
    return {};
  }
  const parsed = Schema.decodeUnknownResult(BaselineJson)(
    readFileSync(path, "utf8"),
  );
  if (parsed._tag === "Failure") {
    console.error(`lint-ratchet: ${BASELINE_FILE} is not valid.`);
    process.exit(2);
  }
  return parsed.success;
}

function main(args: readonly string[]) {
  const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const baselinePath = join(appRoot, BASELINE_FILE);

  const init = args.includes("--init");
  if (init && existsSync(baselinePath)) {
    console.error(`lint-ratchet: ${BASELINE_FILE} already exists.`);
    process.exit(1);
  }

  failOnForbiddenDisables(appRoot);
  const actual = collectActual(appRoot);

  if (init) {
    writeFileSync(baselinePath, sortedJson(actual));
    return;
  }

  const baseline = readBaseline(baselinePath);
  const { increased, decreased } = compareBaseline(baseline, actual);

  if (increased.length > 0) {
    console.error("lint-ratchet: new violations beyond the baseline:");
    for (const entry of increased) {
      console.error(describe(entry));
    }
    console.error("Fix them. Never add to the baseline or raise a count.");
    process.exit(1);
  }

  if (args.includes("--update")) {
    writeFileSync(baselinePath, sortedJson(lowerBaseline(baseline, actual)));
    return;
  }

  if (decreased.length > 0) {
    console.error("lint-ratchet: the baseline can shrink:");
    for (const entry of decreased) {
      console.error(describe(entry));
    }
    console.error("Run: bun run --cwd apps/mobile lint:ratchet:update");
    process.exit(1);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2));
}
