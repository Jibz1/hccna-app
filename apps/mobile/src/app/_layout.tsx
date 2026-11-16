import "../global";
import "../../global.css";
import * as Sentry from "@sentry/react-native";
import { StatsigProviderExpo } from "@statsig/expo-bindings";
import "react-native-reanimated";
import * as SplashScreen from "expo-splash-screen";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { PressablesConfig } from "pressto";
import { Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AnimatedSplashOverlay } from "@/components/layout/AnimatedSplashOverlay";
import { ForceUpdateProvider } from "@/components/providers/ForceUpdate";
import { GlobalErrorBoundary } from "@/components/providers/GlobalErrorBoundary";
import { RelayEnvironmentProvider } from "@/components/providers/RelayEnvironmentProvider";
import { AppAtomRegistryProvider } from "@/effect/atomRegistry";
import {
  createEnvironment,
  environmentAtom,
  recordRelayEnvironmentAuthScopeSwitch,
} from "@/environment";
import { useIsLoggedIn } from "@/hooks/auth/useIsLoggedIn";
import { useBackgroundService } from "@/hooks/utils/useBackgroundService";
import { usePushRegistrationSync } from "@/hooks/utils/usePushRegistrationSync";
import { resolveRelayEnvironmentState } from "@/relay/relayEnvironmentLifecycle";
import { AppThemeProvider } from "@/theme/AppThemeProvider";
import { Text } from "@/ui/Text";
import { initSentry } from "@/utils/sentry";
import { statsigProviderClient } from "@/utils/statsig";

import BaseRoutes from "./base-routes";

// @ts-expect-error
globalThis.RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;

// Keep the native splash visible until the animated React overlay has mounted.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from "expo-router";

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  anchor: "(tabs)",
};

function SuspenseDevWarning() {
  return (
    <View className="p-l gap-s w-full flex-1 items-center justify-center">
      <Text variant="headingSm/bold" color="negative" centered>
        This is the root-level suspense boundary in the application, which
        should never be visible in the application. If you are seeing this, it
        means you do not have a lower suspense boundary in your component tree.
      </Text>
      <Text variant="headingXs/regular" centered>
        This screen is only shown in development mode. In production, it will be
        an empty white screen.
      </Text>
    </View>
  );
}

function RootLayoutImp() {
  const { authScope, isAuthReady } = useIsLoggedIn();

  useEffect(() => {
    initSentry();
  }, []);

  return (
    <GlobalErrorBoundary>
      <RootLayoutNav authScope={authScope} isAuthReady={isAuthReady} />
    </GlobalErrorBoundary>
  );
}

function RootLayoutNav({
  authScope,
  isAuthReady,
}: {
  authScope: string;
  isAuthReady: boolean;
}) {
  const hasHiddenNativeSplash = useRef(false);
  const relayEnvironmentState = useAtomValue(environmentAtom);
  const setEnvironment = useSetAtom(environmentAtom);
  const store = useStore();

  useLayoutEffect(() => {
    const current = store.get(environmentAtom);
    const next = resolveRelayEnvironmentState({
      authScope,
      createEnvironment,
      current,
      isAuthReady,
      onAuthScopeChanged: recordRelayEnvironmentAuthScopeSwitch,
    });

    if (next !== current) {
      setEnvironment(next);
    }
  }, [authScope, isAuthReady, setEnvironment, store]);

  const started = useBackgroundService(isAuthReady);
  const isRelayEnvironmentReady =
    relayEnvironmentState?.authScope === authScope;
  const isAppReady = started && isAuthReady && isRelayEnvironmentReady;
  usePushRegistrationSync(isAppReady);

  const handleOverlayReady = () => {
    if (hasHiddenNativeSplash.current) {
      return;
    }

    hasHiddenNativeSplash.current = true;
    SplashScreen.hideAsync().catch(() => {});
  };

  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <AnimatedSplashOverlay
          appReady={isAppReady}
          onReadyToDisplay={handleOverlayReady}
        />

        {isAppReady ? (
          <StatsigProviderExpo client={statsigProviderClient}>
            <AppAtomRegistryProvider>
              <ForceUpdateProvider>
                <Suspense fallback={__DEV__ ? <SuspenseDevWarning /> : null}>
                  <RelayEnvironmentProvider>
                    <PressablesConfig globalHandlers={{}}>
                      <BaseRoutes />
                    </PressablesConfig>
                  </RelayEnvironmentProvider>
                </Suspense>
              </ForceUpdateProvider>
            </AppAtomRegistryProvider>
          </StatsigProviderExpo>
        ) : null}
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}

const RootLayout = Sentry.wrap(RootLayoutImp);
export default RootLayout;
