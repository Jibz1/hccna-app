import { Effect, Layer } from "effect";

import {
  AppCheckService,
  AppCheckServiceDependencies,
  makeAppCheckService,
} from "./appCheckService";
import {
  getRuntimeEnvString,
  getRuntimeExpoExtraString,
} from "./runtimeConfigService";
import { RuntimeConfigServiceLive } from "./runtimeConfigServiceLive";

function getDebugToken(): string | undefined {
  return Effect.runSync(
    Effect.gen(function* () {
      return (
        (yield* getRuntimeEnvString("EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN")) ??
        (yield* getRuntimeExpoExtraString("EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN"))
      );
    }).pipe(Effect.provide(RuntimeConfigServiceLive)),
  )?.trim();
}

function makeLiveAppCheckDependencies(): AppCheckServiceDependencies {
  const FirebaseAppCheck =
    require("@react-native-firebase/app-check") as typeof import("@react-native-firebase/app-check");
  const provider = new FirebaseAppCheck.ReactNativeFirebaseAppCheckProvider();

  return {
    isDebugBuild: __DEV__,
    debugToken: getDebugToken(),
    configureProvider: (config) => {
      provider.configure(config);
    },
    activate: async ({ isTokenAutoRefreshEnabled }) => {
      FirebaseAppCheck.initializeAppCheck(undefined, {
        provider,
        isTokenAutoRefreshEnabled,
      });
    },
  };
}

export const AppCheckServiceLive = Layer.succeed(
  AppCheckService,
  makeAppCheckService(makeLiveAppCheckDependencies()),
);
