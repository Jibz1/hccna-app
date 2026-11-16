import { Effect, Layer } from "effect";
import Constants from "expo-constants";

import {
  makeRuntimeConfigService,
  RuntimeConfigService,
} from "@/effect/runtimeConfigService";

type ExpoConstantsWithManifest = typeof Constants & {
  readonly manifest?: { readonly extra?: unknown } | null;
};

export const RuntimeConfigServiceLive = Layer.succeed(
  RuntimeConfigService,
  makeRuntimeConfigService({
    getSources: () => ({
      easProjectId: Constants.easConfig?.projectId,
      embeddedManifestExtra: (Constants as ExpoConstantsWithManifest).manifest
        ?.extra,
      expoConfigExtra: Constants.expoConfig?.extra,
      updatesManifestExtra: Constants.manifest2?.extra,
    }),
  }),
);

export function runRuntimeConfigEffect<A>(
  effect: Effect.Effect<A, never, RuntimeConfigService>,
): A {
  return Effect.runSync(effect.pipe(Effect.provide(RuntimeConfigServiceLive)));
}
