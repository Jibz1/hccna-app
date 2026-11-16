import { GoogleSignin } from "@react-native-google-signin/google-signin";
import type { StatsigClientExpo } from "@statsig/expo-bindings";
import { Effect, Layer } from "effect";

import {
  applyRelayPersistenceKillSwitchForNextLaunch,
  RELAY_PERSISTENCE_KILL_SWITCH_GATE_NAME,
} from "@/utils/relayPersistence";

import { initializeAppCheck } from "./appCheckService";
import { AppCheckServiceLive } from "./appCheckServiceLive";
import { AppStartupService, makeAppStartupService } from "./appStartupService";
import {
  getRuntimeEnvString,
  getRuntimeExpoExtraString,
} from "./runtimeConfigService";
import { RuntimeConfigServiceLive } from "./runtimeConfigServiceLive";
import { captureSentryException } from "./sentryService";
import { SentryServiceLive } from "./sentryServiceLive";
import { getStatsigClient, initializeStatsig } from "./statsigService";
import { StatsigServiceLive } from "./statsigServiceLive";

const initializeStatsigAndUpdateRelayLaunchLatch = Effect.gen(function* () {
  yield* initializeStatsig();
  const statsig = (yield* getStatsigClient()) as StatsigClientExpo;
  const killSwitchActive = statsig.checkGate(
    RELAY_PERSISTENCE_KILL_SWITCH_GATE_NAME,
  );

  yield* Effect.sync(() => {
    applyRelayPersistenceKillSwitchForNextLaunch(killSwitchActive);
  });
}).pipe(Effect.provide(StatsigServiceLive));

export const AppStartupServiceLive = Layer.succeed(
  AppStartupService,
  makeAppStartupService({
    initializeAppCheck: initializeAppCheck().pipe(
      Effect.provide(AppCheckServiceLive),
    ),
    configureGoogleSignIn: () => {
      const webClientId = Effect.runSync(
        Effect.gen(function* () {
          return (
            (yield* getRuntimeEnvString("EXPO_PUBLIC_GOOGLE_CLIENT_ID")) ??
            (yield* getRuntimeExpoExtraString("EXPO_PUBLIC_GOOGLE_CLIENT_ID"))
          );
        }).pipe(Effect.provide(RuntimeConfigServiceLive)),
      )?.trim();
      if (!webClientId) {
        throw new Error("EXPO_PUBLIC_GOOGLE_CLIENT_ID is not configured");
      }
      GoogleSignin.configure({
        webClientId,
      });
    },
    initializeStatsig: initializeStatsigAndUpdateRelayLaunchLatch,
    captureException: (error) =>
      captureSentryException(error).pipe(Effect.provide(SentryServiceLive)),
  }),
);
