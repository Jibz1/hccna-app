import "@expo/metro-runtime";
import {
  getMessaging,
  setBackgroundMessageHandler,
} from "@react-native-firebase/messaging";
import { ExpoRoot } from "expo-router";
import { ctx } from "expo-router/_ctx";
import { renderRootComponent } from "expo-router/build/renderRootComponent";
import Head from "expo-router/head";
import { Platform } from "react-native";
import "expo-router/build/fast-refresh";

import { useNativeInitialLocation } from "@/hooks/navigation/useNativeInitialLocation";
import { initializeFirebaseAppForWeb } from "@/utils/firebaseApp";
import { runWebAppStartup } from "@/utils/webAppStartup";

// Must be registered outside the React lifecycle: runs for FCM messages that
// arrive while the app is backgrounded or killed. Notification-type messages
// are displayed by the OS; data-only messages are only seen here.
if (Platform.OS !== "web") {
  setBackgroundMessageHandler(getMessaging(), async (remoteMessage) => {
    console.log("[fcm] background message", remoteMessage.messageId);
  });
}

function NativeRouterRoot() {
  const location = useNativeInitialLocation();
  return <ExpoRoot context={ctx} location={location} />;
}

function App() {
  return (
    <Head.Provider>
      {Platform.OS === "web" ? (
        <ExpoRoot context={ctx} />
      ) : (
        <NativeRouterRoot />
      )}
    </Head.Provider>
  );
}

function renderApp() {
  renderRootComponent(App);
}

function reportFirebaseInitializationError(cause: unknown) {
  console.error("[firebase] Web initialization failed", cause);
}

if (Platform.OS === "web" && typeof window !== "undefined") {
  void runWebAppStartup({
    initialize: initializeFirebaseAppForWeb,
    render: renderApp,
    reportInitializationError: reportFirebaseInitializationError,
  });
} else {
  renderApp();
}
