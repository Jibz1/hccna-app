import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { ReactNode } from "react";
import { ErrorBoundary, FallbackProps } from "react-error-boundary";
import { ScrollView, View } from "react-native";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { FeedbackCard } from "@/components/design-v2/FeedbackCard";
import {
  StyledGestureHandlerRootView as GestureHandlerRootView,
  StyledLinearGradient as LinearGradient,
} from "@/cssInterop";
import SvgWarningTriangular from "@/icons/WarningTriangular";
import { AppThemeProvider } from "@/theme/AppThemeProvider";
import { useAppTheme } from "@/theme/useAppTheme";
import { Text } from "@/ui/Text";
import { captureException } from "@/utils/sentry";

function FallbackContent({ resetErrorBoundary }: FallbackProps) {
  const { colors, isDark, backgroundGradient, backgroundGradientLocations } =
    useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <GestureHandlerRootView
      className="bg-design-background flex-1"
      onLayout={() => {
        void SplashScreen.hideAsync();
      }}
    >
      <StatusBar style={isDark ? "light" : "dark"} />
      <LinearGradient
        pointerEvents="none"
        colors={backgroundGradient}
        locations={backgroundGradientLocations}
        className="absolute inset-0"
      />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerClassName="grow items-center justify-center px-6"
        contentContainerStyle={{
          paddingTop: insets.top + 32,
          paddingBottom: insets.bottom + 32,
          paddingLeft: insets.left + 24,
          paddingRight: insets.right + 24,
        }}
      >
        <View className="w-full max-w-[440px] items-center gap-6">
          <Text variant="caption/medium" color="designAccent">
            HCCNA
          </Text>
          <FeedbackCard
            title="Let’s try that again"
            message="Something went wrong while opening the app. Please try again."
            icon=<SvgWarningTriangular
              width={24}
              height={24}
              color={colors.accent}
            />
            onAction={resetErrorBoundary}
          />
          <Text variant="caption/regular" color="designMuted" centered>
            If this keeps happening, close and reopen HCCNA.
          </Text>
        </View>
      </ScrollView>
    </GestureHandlerRootView>
  );
}

function FallbackComponent(props: FallbackProps) {
  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <FallbackContent {...props} />
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}

export function GlobalErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      FallbackComponent={FallbackComponent}
      onError={(error) => {
        try {
          captureException(error);
        } catch (e) {
          console.error("Failed to capture exception:", e);
        }
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
