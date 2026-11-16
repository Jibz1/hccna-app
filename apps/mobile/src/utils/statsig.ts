import type { StatsigClientExpo } from "@statsig/expo-bindings";
import { Predicate } from "effect";

import { runLiveAppEffectSync } from "@/effect/appRuntimeLive";
import {
  getStatsigClient,
  getStatsigDynamicConfig,
  logStatsigEvent,
  type StatsigEventMetadata,
  type StatsigEventValue,
} from "@/effect/statsigService";
import type { DynamicConfigName, FeatureGateName } from "@/featureGates/names";

/**
 * The Statsig client with gate and config reads narrowed to the registered names in
 * `@/featureGates/names`. The lookups that take any name are left out.
 */
type RegisteredStatsigClient = Omit<
  StatsigClientExpo,
  | "checkGate"
  | "getDynamicConfig"
  | "getFeatureGate"
  | "getExperiment"
  | "getLayer"
> & {
  readonly checkGate: (
    name: FeatureGateName,
    options?: Parameters<StatsigClientExpo["checkGate"]>[1],
  ) => boolean;
  readonly getDynamicConfig: (
    name: DynamicConfigName,
    options?: Parameters<StatsigClientExpo["getDynamicConfig"]>[1],
  ) => ReturnType<StatsigClientExpo["getDynamicConfig"]>;
};

function getRuntimeStatsigClient(): StatsigClientExpo {
  return runLiveAppEffectSync(getStatsigClient()) as StatsigClientExpo;
}

function getRuntimeStatsigDynamicConfig(
  name: DynamicConfigName,
  options?: Parameters<StatsigClientExpo["getDynamicConfig"]>[1],
): ReturnType<StatsigClientExpo["getDynamicConfig"]> {
  return runLiveAppEffectSync(getStatsigDynamicConfig(name, options));
}

function logRuntimeStatsigEvent(
  eventName: string,
  value?: StatsigEventValue,
  metadata?: StatsigEventMetadata,
): void {
  runLiveAppEffectSync(logStatsigEvent(eventName, value, metadata));
}

const statsigProxy = new Proxy({} as StatsigClientExpo, {
  get(_, prop) {
    if (prop === "logEvent") {
      return logRuntimeStatsigEvent;
    }

    if (prop === "getDynamicConfig") {
      return getRuntimeStatsigDynamicConfig;
    }

    const client = getRuntimeStatsigClient();
    const value = client[prop as keyof StatsigClientExpo];
    return Predicate.isFunction(value) ? value.bind(client) : value;
  },
});

/** Gate and config reads take only registered names; prefer `@/featureGates/react` in components. */
export const statsig: RegisteredStatsigClient = statsigProxy;

/** The same client, untyped by name, for `StatsigProviderExpo` only. */
export const statsigProviderClient: StatsigClientExpo = statsigProxy;
