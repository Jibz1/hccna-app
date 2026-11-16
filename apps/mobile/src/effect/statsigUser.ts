import type { StatsigUser } from "@statsig/expo-bindings";

type StatsigUserInput = {
  readonly appVersion?: string;
  readonly authenticatedUserEmail?: string | null;
  readonly optInFeatures?: readonly string[];
  readonly platform: string;
  readonly preferencesID?: string;
  readonly stableID?: string;
};

export function makeStatsigUser({
  appVersion,
  authenticatedUserEmail,
  optInFeatures,
  platform,
  preferencesID,
  stableID,
}: StatsigUserInput): StatsigUser {
  return {
    appVersion,
    custom: {
      optInFeatures: `@${optInFeatures?.join("@") ?? ""}@`,
      developerMode: false,
      appPlatform: platform,
      rnPlatform: platform,
      authenticatedUserEmail: authenticatedUserEmail ?? undefined,
    },
    customIDs: {
      preferencesID,
      stableID,
    },
  };
}
