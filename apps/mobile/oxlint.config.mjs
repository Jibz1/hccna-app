import { readFileSync } from "node:fs";

import antiSlopRules from "@hccnj/anti-slop/rules";
import mobileRules from "@hccnj/mobile-lint/rules";
import { defineConfig } from "oxlint";
import native from "oxlint-config-universe/native";
import typescriptAnalysis from "oxlint-config-universe/typescript-analysis";

// Existing violations of the mobile/* rules, per file. The ratchet script sets
// MOBILE_LINT_RATCHET=1 so Oxlint reports them and it can count them itself.
function readBaseline() {
  try {
    return JSON.parse(
      readFileSync(new URL("./lint-baseline.json", import.meta.url), "utf8"),
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

/** A literal file path as an override glob: `src/app/[id].tsx` matches only itself. */
export function escapeGlob(path) {
  return path.replace(/[[\]{}*?]/g, "\\$&");
}

const ratchetRun = process.env.MOBILE_LINT_RATCHET === "1";

const baselineOverrides = ratchetRun
  ? []
  : Object.entries(readBaseline()).map(([rule, files]) => ({
      files: Object.keys(files).map(escapeGlob),
      rules: { [rule]: "off" },
    }));

export default defineConfig({
  extends: [native, typescriptAnalysis],
  jsPlugins: [
    "@shadcn/lint",
    { name: "anti-slop", specifier: "@hccnj/anti-slop" },
    { name: "mobile", specifier: "@hccnj/mobile-lint" },
  ],
  settings: {
    shadcn: {
      ui: "@/ui",
    },
  },
  options: {
    denyWarnings: true,
    reportUnusedDisableDirectives: "error",
  },
  categories: {
    correctness: "error",
  },
  rules: {
    ...antiSlopRules,
    ...mobileRules,
    "no-var": "error",
    "no-void": ["error", { allowAsStatement: true }],
    "react/exhaustive-deps": "error",
    "typescript/no-explicit-any": "off",
    "typescript/no-namespace": "off",
    "typescript/no-redundant-type-constituents": "warn",
    "typescript/no-var-requires": "off",
    "typescript/triple-slash-reference": "off",
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "react-native",
            importNames: ["FlatList", "TouchableOpacity"],
            message:
              "Use `LegendList` from `@legendapp/list` instead. Use either `Pressable` from `react-native` or `TouchableOpacity` from `react-native-gesture-handler` instead.",
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ["**/*.stories.{ts,tsx,js,jsx}"],
      rules: {
        "react/rules-of-hooks": "off",
      },
    },
    {
      files: ["src/hooks/effects/**"],
      rules: {
        "mobile/no-direct-effect": "off",
        "mobile/no-raw-timers": "off",
      },
    },
    {
      files: [
        "src/utils/timers.ts",
        "src/utils/scheduleIdleTask.ts",
        "src/global.ts",
      ],
      rules: { "mobile/no-raw-timers": "off" },
    },
    {
      files: ["src/relay/mutations.ts"],
      rules: { "mobile/no-direct-relay-mutation": "off" },
    },
    {
      files: ["src/featureGates/**"],
      rules: { "mobile/no-direct-feature-gate": "off" },
    },
    {
      files: ["src/effect/**"],
      rules: { "mobile/no-direct-auth-listener": "off" },
    },
    {
      files: ["**/*.test.{ts,tsx,mjs}"],
      rules: {
        "mobile/no-direct-effect": "off",
        "mobile/no-raw-timers": "off",
      },
    },
    ...baselineOverrides,
  ],
  ignorePatterns: [
    ".expo/**",
    ".github/**",
    "android/**",
    "babel.config.js",
    "ios/**",
    "build/**",
    "coverage/**",
    "dist/**",
    "metro.config.js",
    "native-version.js",
    "public/**",
    "src/icons/**",
    "src/**/__generated__/**",
    "**/*.d.ts",
    "uniwind-env.d.ts",
    "uniwind-types.d.ts",
    // One violation of each ratcheted rule; only the ratchet run lints it.
    ...(ratchetRun ? [] : ["scripts/lint-ratchet.canary.tsx"]),
  ],
});
