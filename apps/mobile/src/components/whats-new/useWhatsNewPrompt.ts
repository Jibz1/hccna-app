import { nativeApplicationVersion } from "expo-application";
import { useRootNavigationState, useRouter } from "expo-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";

import { useGate } from "@/featureGates/react";
import { useConnectivityStatus } from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import { useDevicePrefs } from "@/utils/devicePrefs";

import { isReleaseUnseen, WHATS_NEW_GATE } from "./releaseNotes";
import { useWhatsNewRelease } from "./useWhatsNewRelease";

function subscribeToAppState(onChange: () => void) {
  const subscription = AppState.addEventListener("change", onChange);
  return () => {
    subscription.remove();
  };
}

const isAppActive = () => AppState.currentState === "active";

export function useWhatsNewPrompt(canShowPrompt: boolean): boolean {
  const router = useRouter();
  const navigation = useRootNavigationState();
  const connectivityStatus = useConnectivityStatus();
  const { whatsNewLastSeenVersion } = useDevicePrefs();
  const showWhatsNew = useGate(WHATS_NEW_GATE);
  const { configuredRelease } = useWhatsNewRelease();
  const [hasPresented, setHasPresented] = useState(false);
  const appIsActive = useSyncExternalStore(
    subscribeToAppState,
    isAppActive,
    () => false,
  );
  const pending =
    connectivityStatus === "online" &&
    Platform.OS !== "web" &&
    Boolean(nativeApplicationVersion) &&
    showWhatsNew &&
    isReleaseUnseen(configuredRelease, whatsNewLastSeenVersion);

  useEffect(() => {
    if (
      !pending ||
      hasPresented ||
      !canShowPrompt ||
      !appIsActive ||
      !navigation?.key
    ) {
      return;
    }

    // Let the splash and navigation settle; leaving Home cancels presentation.
    const timer = setTimeout(() => {
      setHasPresented(true);
      router.push("/whats-new");
    }, 600);
    return () => {
      clearTimeout(timer);
    };
  }, [
    pending,
    hasPresented,
    canShowPrompt,
    appIsActive,
    navigation?.key,
    router,
  ]);

  // Avoid following the release notes with a second invitation this session.
  return pending || hasPresented;
}
