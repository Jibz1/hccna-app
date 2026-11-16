import { readFileSync } from "node:fs";

import { expect, test, vi } from "vitest";

import {
  bailoutFromEvent,
  bailoutsForSources,
  listCompilerBailouts,
} from "./compiler-coverage";

// Compiling every file under src takes a while.
vi.setConfig({ testTimeout: 60_000 });

const baseline = JSON.parse(
  readFileSync(new URL("../compiler-baseline.json", import.meta.url), "utf8"),
);
const skipped = [
  ...new Set(listCompilerBailouts().map((bailout) => bailout.file)),
].sort();

test("the React Compiler skips no new files", () => {
  expect(skipped.filter((file) => !baseline.includes(file))).toEqual([]);
});

test("the baseline lists only files that are still skipped", () => {
  expect(baseline.filter((file) => !skipped.includes(file))).toEqual([]);
});

const fnLoc = { start: { line: 12, column: 0 }, end: { line: 20, column: 1 } };

test("a CompileError event becomes a bailout with its reason and line", () => {
  expect(
    bailoutFromEvent("src/a.tsx", {
      kind: "CompileError",
      fnLoc,
      detail: { reason: "try/finally is not supported" },
    }),
  ).toEqual({
    file: "src/a.tsx",
    line: 12,
    reason: "try/finally is not supported",
  });
});

test("a PipelineError event becomes a bailout whose reason is its data", () => {
  expect(
    bailoutFromEvent("src/a.tsx", {
      kind: "PipelineError",
      fnLoc,
      data: "internal crash",
    }),
  ).toEqual({ file: "src/a.tsx", line: 12, reason: "internal crash" });
  expect(
    bailoutFromEvent("src/a.tsx", {
      kind: "PipelineError",
      fnLoc: null,
      data: "internal crash",
    }),
  ).toEqual({ file: "src/a.tsx", line: 0, reason: "internal crash" });
});

test("a CompileSkip event (a function-level opt-out) becomes a bailout", () => {
  expect(
    bailoutFromEvent("src/a.tsx", {
      kind: "CompileSkip",
      fnLoc,
      reason: "Skipped due to 'use no memo' directive.",
      loc: null,
    }),
  ).toEqual({
    file: "src/a.tsx",
    line: 12,
    reason: "Skipped due to 'use no memo' directive.",
  });
});

test("the real compiler reports both function- and module-level opt-outs", () => {
  const component = "const x = [n];\n  return <B x={x} />;";
  const bailouts = bailoutsForSources([
    {
      file: "src/components/Plain.tsx",
      code: `export function A({ n }) {\n  ${component}\n}\n`,
    },
    {
      file: "src/components/FunctionOptOut.tsx",
      code: `export function A({ n }) {\n  "use no memo";\n  ${component}\n}\n`,
    },
    {
      file: "src/components/ModuleOptOut.tsx",
      code: `"use no forget";\nexport function A({ n }) {\n  ${component}\n}\n`,
    },
  ]);
  expect(bailouts.map(({ file, line }) => ({ file, line }))).toEqual([
    { file: "src/components/FunctionOptOut.tsx", line: 1 },
    { file: "src/components/ModuleOptOut.tsx", line: 1 },
  ]);
});

test("other events are not bailouts", () => {
  expect(
    bailoutFromEvent("src/a.tsx", { kind: "CompileSuccess", fnLoc }),
  ).toBeUndefined();
});
