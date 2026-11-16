import { RuleTester } from "oxlint/plugins-dev";

import { noDirectFeatureGateRule } from "./no-direct-feature-gate.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const error = { messageId: "restricted" };

tester.run("mobile/no-direct-feature-gate", noDirectFeatureGateRule, {
  valid: ['import { StatsigProviderExpo, StatsigClientExpo } from "@statsig/expo-bindings";'],
  invalid: [
    {
      name: "gate",
      code: 'import { useFeatureGate } from "@statsig/expo-bindings";',
      errors: [error],
    },
    {
      name: "config alias",
      code: 'import { useDynamicConfig as useStatsigConfig } from "@statsig/expo-bindings";',
      errors: [error],
    },
    {
      name: "message",
      code: 'import { useGateValue } from "@statsig/expo-bindings";',
      errors: [
        {
          message:
            "Do not import `useGateValue` from `@statsig/expo-bindings`. Use `useGate` or `useConfig` from `@/featureGates/react` with a name from `@/featureGates/names`.",
        },
      ],
    },
    {
      name: "client hook",
      code: 'import { useStatsigClient } from "@statsig/expo-bindings";',
      errors: [error],
    },
    {
      name: "namespace import",
      code: 'import * as Statsig from "@statsig/react-bindings";',
      errors: [error],
    },
    {
      name: "experiment",
      code: 'import { useExperiment } from "@statsig/react-bindings";',
      errors: [error],
    },
  ],
});
