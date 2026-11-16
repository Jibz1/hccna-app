import { restrictedImportRule } from "../shared/restricted-import.ts";

/** Ban Statsig's raw gate and config hooks in favour of the typed wrappers. */
export const noDirectFeatureGateRule = restrictedImportRule({
  description: "Disallow importing Statsig gate and config hooks directly.",
  message:
    "Use `useGate` or `useConfig` from `@/featureGates/react` with a name from `@/featureGates/names`.",
  sources: ["@statsig/expo-bindings", "@statsig/react-bindings"],
  names: [
    "useFeatureGate",
    "useGateValue",
    "useDynamicConfig",
    "useExperiment",
    "useLayer",
    "useParameterStore",
    "useStatsigClient",
  ],
});
