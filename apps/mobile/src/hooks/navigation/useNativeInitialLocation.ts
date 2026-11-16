import * as Linking from "expo-linking";
import { useEffect, useState } from "react";

function normalizeInitialLocation(url: string | null): string {
  if (!url || url.includes("://expo-development-client/")) {
    return "/";
  }

  const withoutOrigin = url.replace(/^https?:\/\/[^/?#]+/, "");
  if (withoutOrigin !== url) {
    return withoutOrigin.startsWith("/") ? withoutOrigin : `/${withoutOrigin}`;
  }

  const schemeMatch = url.match(/^[\w\d+.-]+:\/\/(.*)$/);
  if (schemeMatch) {
    const path = schemeMatch[1] ?? "";
    return path.startsWith("/") ? path : `/${path}`;
  }

  return url.startsWith("/") ? url : "/";
}

export function useNativeInitialLocation() {
  const [initialLocation] = useState(() =>
    normalizeInitialLocation(Linking.getLinkingURL()),
  );

  useEffect(() => {
    // The native cache survives a JS reload. Consume both the launch link and
    // subsequent links after delivery so a reload starts at Home. Expo Router
    // still receives live URL events and handles the original launch location.
    Linking.clearInitialURL();
    const subscription = Linking.addEventListener("url", () => {
      Linking.clearInitialURL();
    });
    return () => {
      subscription.remove();
    };
  }, []);

  return initialLocation;
}
