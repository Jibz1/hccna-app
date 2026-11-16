import { getAuth, onAuthStateChanged } from "@react-native-firebase/auth";
import { StableID, StatsigMetadataProvider } from "@statsig/client-core";
import { StatsigClientExpo } from "@statsig/expo-bindings";
import type { StatsigUser } from "@statsig/expo-bindings";
import { Effect, Layer } from "effect";
import * as Application from "expo-application";
import Constants from "expo-constants";
import fastDeepEqual from "fast-deep-equal";
import { Platform } from "react-native";

import type { DynamicConfigName, FeatureGateName } from "@/featureGates/names";
import { DevicePrefs } from "@/utils/devicePrefs";
import { statsigStorage } from "@/utils/mmkv";
import { scheduleIdleTask } from "@/utils/scheduleIdleTask";

import { resolveStatsigAppVersion } from "./statsigAppVersion";
import {
  getStatsigClient,
  getStatsigDynamicConfig,
  isStatsigReady,
  makeStatsigService,
  StatsigService,
} from "./statsigService";
import { makeStatsigUser } from "./statsigUser";

const STATSIG_CLIENT_KEY = "client-x5YXeo6hfFgT59QI41cvchPA2NvxN5HmIMEocJPkBho";
function getUser(): StatsigUser {
  const devicePrefs = DevicePrefs.getSnapshot();
  const stableID = StableID.get(STATSIG_CLIENT_KEY) ?? undefined;

  return makeStatsigUser({
    appVersion: getStatsigAppVersion(),
    authenticatedUserEmail: getAuth().currentUser?.email,
    optInFeatures: devicePrefs.optInFeatures ?? undefined,
    platform: Platform.OS,
    preferencesID: devicePrefs?.id,
    stableID,
  });
}

function getStatsigAppVersion(): string | undefined {
  return resolveStatsigAppVersion(
    Constants.expoConfig?.version,
    Application.nativeApplicationVersion,
  );
}

function createStatsigClient(user: StatsigUser) {
  const client = new StatsigClientExpo(STATSIG_CLIENT_KEY, user, {
    networkConfig: {},
    environment: { tier: "production" },
    storageProvider: {
      isReady: () => true,
      isReadyResolver: () => null,
      getProviderName: () => "mmkv",
      getItem: (key: string) => statsigStorage.getString(key) ?? null,
      setItem: (key: string, value: string) => {
        statsigStorage.set(key, value);
      },
      removeItem: (key: string) => {
        statsigStorage.remove(key);
      },
      getAllKeys: () => statsigStorage.getAllKeys(),
    },
  });

  // StatsigClientExpo replaces this global metadata value with the installed
  // binary version. Re-apply the Expo config version so OTA releases report
  // the version sourced from native-version.js.
  StatsigMetadataProvider.add({ appVersion: getStatsigAppVersion() });

  return client;
}

export const StatsigServiceLive = Layer.succeed(
  StatsigService,
  makeStatsigService({
    getUser,
    createClient: createStatsigClient,
    usersEqual: fastDeepEqual,
    scheduleAfterInteractions: (task) => scheduleIdleTask(task),
    addUserChangeListeners: (listener) => {
      DevicePrefs.subscribe(listener);
      onAuthStateChanged(getAuth(), listener);
    },
  }),
);

export function isLiveStatsigReady(): boolean {
  return Effect.runSync(
    isStatsigReady().pipe(Effect.provide(StatsigServiceLive)),
  );
}

export function getLiveStatsigDynamicConfig(
  name: DynamicConfigName,
  options?: Parameters<StatsigClientExpo["getDynamicConfig"]>[1],
): ReturnType<StatsigClientExpo["getDynamicConfig"]> {
  return Effect.runSync(
    getStatsigDynamicConfig(name, options).pipe(
      Effect.provide(StatsigServiceLive),
    ),
  );
}

export function checkLiveStatsigGate(name: FeatureGateName): boolean {
  return Effect.runSync(
    getStatsigClient().pipe(
      Effect.map((client) => (client as StatsigClientExpo).checkGate(name)),
      Effect.provide(StatsigServiceLive),
    ),
  );
}
