import { describe, expect, test } from "vitest";

import { escapeGlob } from "../oxlint.config.mjs";
import {
  CANARY_FILE,
  RATCHETED_RULES,
  compareBaseline,
  countViolations,
  findForbiddenDisables,
  lowerBaseline,
  missingCanaryRules,
} from "./lint-ratchet.ts";

const effect = "mobile/no-direct-effect";

describe("lint ratchet", () => {
  test("counts only ratcheted rules, per file", () => {
    expect(
      countViolations([
        { code: "mobile(no-direct-effect)", filename: "src/a.tsx" },
        { code: "mobile(no-direct-effect)", filename: "./src/a.tsx" },
        { code: "mobile(no-raw-timers)", filename: "src/a.tsx" },
        { code: "eslint(no-var)", filename: "src/a.tsx" },
      ]),
    ).toEqual({
      [effect]: { "src/a.tsx": 2 },
      "mobile/no-raw-timers": { "src/a.tsx": 1 },
    });
  });

  test("a second violation in a baselined file is an increase", () => {
    const result = compareBaseline(
      { [effect]: { "src/a.tsx": 1 } },
      { [effect]: { "src/a.tsx": 2 } },
    );
    expect(result.increased).toEqual([
      { rule: effect, file: "src/a.tsx", baseline: 1, actual: 2 },
    ]);
    expect(result.decreased).toEqual([]);
  });

  test("a violation in a new file is an increase", () => {
    const result = compareBaseline({}, { [effect]: { "src/new.tsx": 1 } });
    expect(result.increased).toEqual([
      { rule: effect, file: "src/new.tsx", baseline: 0, actual: 1 },
    ]);
  });

  test("a fixed file is a decrease", () => {
    const result = compareBaseline({ [effect]: { "src/a.tsx": 2 } }, {});
    expect(result.decreased).toEqual([
      { rule: effect, file: "src/a.tsx", baseline: 2, actual: 0 },
    ]);
  });

  test("a renamed file is one decrease and one increase", () => {
    const result = compareBaseline(
      { [effect]: { "src/old.tsx": 1 } },
      { [effect]: { "src/new.tsx": 1 } },
    );
    expect(result.decreased).toHaveLength(1);
    expect(result.increased).toHaveLength(1);
  });

  test("lowerBaseline never adds or raises", () => {
    expect(
      lowerBaseline(
        { [effect]: { "src/a.tsx": 3, "src/b.tsx": 1, "src/c.tsx": 1 } },
        { [effect]: { "src/a.tsx": 1, "src/c.tsx": 4, "src/new.tsx": 2 } },
      ),
    ).toEqual({ [effect]: { "src/a.tsx": 1, "src/c.tsx": 1 } });
  });
});

describe("forbidden disable comments", () => {
  test("a next-line disable naming a mobile rule is forbidden", () => {
    const source =
      "const a = 1;\n// oxlint-disable-next-line mobile/no-direct-effect\nuseEffect(f);\n";
    expect(findForbiddenDisables(source)).toEqual([
      {
        line: 2,
        comment: "// oxlint-disable-next-line mobile/no-direct-effect",
      },
    ]);
  });

  test("eslint-disable-next-line naming a mobile rule is forbidden", () => {
    expect(
      findForbiddenDisables(
        "// eslint-disable-next-line mobile/no-raw-timers -- just once\n",
      ),
    ).toEqual([
      {
        line: 1,
        comment:
          "// eslint-disable-next-line mobile/no-raw-timers -- just once",
      },
    ]);
  });

  test("a file-level block naming a mobile rule is forbidden", () => {
    expect(
      findForbiddenDisables("/* oxlint-disable mobile/no-raw-timers */\n"),
    ).toEqual([
      { line: 1, comment: "/* oxlint-disable mobile/no-raw-timers */" },
    ]);
  });

  test("a blanket block disable is forbidden", () => {
    expect(findForbiddenDisables("\n\n/* oxlint-disable */\n")).toEqual([
      { line: 3, comment: "/* oxlint-disable */" },
    ]);
    expect(findForbiddenDisables("/*eslint-disable*/")).toHaveLength(1);
  });

  test("a blanket disable-next-line or disable-line is forbidden", () => {
    expect(
      findForbiddenDisables("// oxlint-disable-next-line\nsetTimeout(f);\n"),
    ).toEqual([{ line: 1, comment: "// oxlint-disable-next-line" }]);
    expect(
      findForbiddenDisables("setTimeout(f); // eslint-disable-line\n"),
    ).toEqual([{ line: 1, comment: "// eslint-disable-line" }]);
    expect(
      findForbiddenDisables(
        "// oxlint-disable-next-line -- a reason, but no rule\n",
      ),
    ).toHaveLength(1);
  });

  test("a disable naming only other rules is allowed", () => {
    expect(
      findForbiddenDisables(
        [
          "// oxlint-disable-next-line react/exhaustive-deps",
          "// oxlint-disable-next-line react/no-children-prop -- intentional: children are pre-processed",
          "// oxlint-disable-next-line no-script-url",
          "/* eslint-disable no-console, react/display-name */",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a list mixing another rule and a mobile rule is forbidden", () => {
    expect(
      findForbiddenDisables(
        "// oxlint-disable-next-line react/exhaustive-deps, mobile/no-direct-effect\n",
      ),
    ).toHaveLength(1);
    expect(
      findForbiddenDisables(
        "/* eslint-disable\n  no-console,\n  mobile/no-raw-timers\n*/\n",
      ),
    ).toEqual([
      {
        line: 1,
        comment: "/* eslint-disable\n  no-console,\n  mobile/no-raw-timers\n*/",
      },
    ]);
  });

  test("ordinary comments and enable directives are not disables", () => {
    expect(
      findForbiddenDisables(
        "// see the oxlint docs\n/* oxlint-enable mobile/no-raw-timers */\n// oxlint-disabled-thing\n",
      ),
    ).toEqual([]);
  });
});

describe("canary", () => {
  const canaryDiagnostics = RATCHETED_RULES.map((rule) => ({
    code: `mobile(${rule.slice("mobile/".length)})`,
    filename: CANARY_FILE,
  }));

  test("every rule reporting in the canary leaves nothing missing", () => {
    expect(missingCanaryRules(canaryDiagnostics)).toEqual([]);
  });

  test("a rule with no canary diagnostic is missing", () => {
    expect(
      missingCanaryRules([
        ...canaryDiagnostics.filter(
          (diagnostic) => diagnostic.code !== "mobile(no-raw-timers)",
        ),
        { code: "mobile(no-raw-timers)", filename: "src/a.tsx" },
      ]),
    ).toEqual(["mobile/no-raw-timers"]);
  });

  test("no diagnostics at all means every rule is missing", () => {
    expect(missingCanaryRules([])).toEqual([...RATCHETED_RULES]);
  });

  test("a ./-prefixed canary path still counts", () => {
    expect(
      missingCanaryRules(
        canaryDiagnostics.map((diagnostic) => ({
          ...diagnostic,
          filename: `./${diagnostic.filename}`,
        })),
      ),
    ).toEqual([]);
  });

  test("canary diagnostics are never counted", () => {
    expect(
      countViolations([
        ...canaryDiagnostics,
        { code: "mobile(no-direct-effect)", filename: "src/a.tsx" },
      ]),
    ).toEqual({ [effect]: { "src/a.tsx": 1 } });
  });
});

describe("baseline keys as override globs", () => {
  test("glob metacharacters are escaped so a path matches only itself", () => {
    expect(escapeGlob("src/app/news/[eventSlug].tsx")).toBe(
      "src/app/news/\\[eventSlug\\].tsx",
    );
    expect(escapeGlob("src/a{b,c}*?.ts")).toBe("src/a\\{b,c\\}\\*\\?.ts");
  });

  test("plain paths and parentheses are unchanged", () => {
    expect(escapeGlob("src/app/(tabs)/_layout.ios.tsx")).toBe(
      "src/app/(tabs)/_layout.ios.tsx",
    );
  });
});
