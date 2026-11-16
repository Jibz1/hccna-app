import {
  type DynamicConfigEvaluationOptions,
  useDynamicConfig,
  useFeatureGate,
} from "@statsig/expo-bindings";

import type { DynamicConfigName, FeatureGateName } from "./names";

/** The only place the app reads Statsig's React hooks. */
export function useGate(name: FeatureGateName): boolean {
  return useFeatureGate(name).value;
}

export function useConfig(
  name: DynamicConfigName,
  options?: DynamicConfigEvaluationOptions,
): ReturnType<typeof useDynamicConfig> {
  return useDynamicConfig(name, options);
}
