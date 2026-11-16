import { Option } from "effect";
import { nativeApplicationVersion } from "expo-application";
import Constants from "expo-constants";
import { useMemo } from "react";

import { useConfig } from "@/featureGates/react";

import {
  decodeWhatsNewConfig,
  getConfiguredReleaseNotes,
  getReleaseNotes,
  WHATS_NEW_CONFIG,
} from "./releaseNotes";

export function useWhatsNewRelease() {
  const { value } = useConfig(WHATS_NEW_CONFIG);
  const installedVersion =
    nativeApplicationVersion ?? Constants.expoConfig?.version;
  const configuredRelease = useMemo(
    () =>
      getConfiguredReleaseNotes(
        installedVersion,
        Option.getOrUndefined(decodeWhatsNewConfig(value))?.release,
      ),
    [installedVersion, value],
  );

  return {
    configuredRelease,
    release: configuredRelease ?? getReleaseNotes(installedVersion),
  };
}
