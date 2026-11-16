import { Image } from "expo-image";
import { useRef, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, { Easing, FadeOut } from "react-native-reanimated";

import SplashImage from "@/../assets/images/icon.png";
import { StyledLinearGradient as LinearGradient } from "@/cssInterop";
import { useAppTheme } from "@/theme/useAppTheme";

const FADE_DURATION = 220;
const LOGO_SIZE = 85;

type AnimatedSplashOverlayProps = {
  appReady: boolean;
  onReadyToDisplay?: () => void;
};

export function AnimatedSplashOverlay({
  appReady,
  onReadyToDisplay,
}: AnimatedSplashOverlayProps) {
  const { backgroundGradient, backgroundGradientLocations } = useAppTheme();
  const [phase, setPhase] = useState<
    "waiting-layout" | "visible" | "dismissed"
  >("waiting-layout");
  const hasNotifiedReady = useRef(false);

  // Keep the first frame until onLayout has handed off the native splash.
  // Once dismissed, later readiness changes must not bring the overlay back.
  if (phase === "visible" && appReady) {
    setPhase("dismissed");
    return null;
  }

  const handleLayout = () => {
    if (hasNotifiedReady.current) {
      return;
    }

    hasNotifiedReady.current = true;
    onReadyToDisplay?.();
    setPhase(appReady ? "dismissed" : "visible");
  };

  if (phase === "dismissed") {
    return null;
  }

  return (
    <Animated.View
      onLayout={handleLayout}
      exiting={FadeOut.duration(FADE_DURATION).easing(Easing.out(Easing.ease))}
      style={styles.overlay}
      pointerEvents="auto"
      className="bg-design-background absolute inset-0 z-9999 flex-1 items-center justify-center"
    >
      <LinearGradient
        colors={backgroundGradient}
        locations={backgroundGradientLocations}
        className="absolute inset-0"
      />
      <Image source={SplashImage} contentFit="contain" style={styles.logo} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Android elevation keeps the splash above the navigation surface.
  overlay: { elevation: 9999 },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
});
