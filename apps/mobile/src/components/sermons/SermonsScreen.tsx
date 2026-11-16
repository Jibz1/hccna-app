import { Suspense, useState } from "react";
import { View } from "react-native";
import { useSharedValue } from "react-native-reanimated";

import { FeedbackCard } from "@/components/design-v2/FeedbackCard";
import { AnimatedHeader } from "@/components/layout/AnimatedHeader";
import { useTabScreenLayout } from "@/components/layout/useTabScreenLayout";
import { ErrorBoundaryWithRetry } from "@/components/providers/ErrorBoundaryWithRetry";
import {
  SermonsContainer,
  useHasCachedSermons,
} from "@/components/sermons/SermonsContainer";
import { SermonsListState } from "@/components/sermons/SermonsItems";
import {
  SermonsShortsSwitch,
  type SermonsTabMode,
} from "@/components/shorts/SermonsShortsSwitch";
import { ShortsFeed } from "@/components/shorts/ShortsFeed";
import { useShortsFeedEnabled } from "@/components/shorts/useShortsFeedEnabled";
import { connectivity } from "@/effect/connectivity";
import { useConnectivityAwareFetchPolicy } from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import SvgWifiOff from "@/icons/WifiOff";
import { useAppTheme } from "@/theme/useAppTheme";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

export default function SermonsScreen() {
  const shortsEnabled = useShortsFeedEnabled();
  // Component state: the tab opens on Sermons at every launch and, because
  // tabs stay mounted, keeps the side last shown for the rest of the session.
  const [mode, setMode] = useState<SermonsTabMode>("sermons");
  const [switchHeight, setSwitchHeight] = useState(0);
  const layout = useTabScreenLayout(0, shortsEnabled ? switchHeight : 0);
  const { colors } = useAppTheme();
  const fetchPolicy = useConnectivityAwareFetchPolicy();
  const hasCachedSermons = useHasCachedSermons();
  const showShorts = shortsEnabled && mode === "shorts";
  // Owned here so it can be reset: each side of the switch starts at the top,
  // and a carried-over position would leave the header blurred at rest.
  const headerScrollY = useSharedValue(0);
  return (
    <View className="bg-design-background flex-1">
      <AnimatedHeader layout={layout} scrollY={headerScrollY}>
        {(scrollProps) =>
          showShorts ? (
            // Mounted only while showing, so each switch to Shorts reshuffles
            // and people who never switch load no player and no extra query.
            <ShortsFeed
              topPadding={layout.contentTop}
              bottomPadding={layout.contentContainerStyle.paddingBottom}
              fetchPolicy={fetchPolicy}
            />
          ) : fetchPolicy === "store-only" && !hasCachedSermons ? (
            <SermonsListState scrollProps={scrollProps}>
              <FeedbackCard
                title="Sermons unavailable offline"
                message="Connect to the internet, then try again."
                icon=<SvgWifiOff width={24} height={24} color={colors.accent} />
                onAction={() => {
                  void connectivity.refresh().catch(() => undefined);
                }}
              />
            </SermonsListState>
          ) : (
            <ErrorBoundaryWithRetry
              title="Unable to load sermons"
              subtitle="Please check your connection and try again."
              fallbackClassName="border-design-border bg-design-surface rounded-[26px] border"
              fallbackRender={(fallback) => (
                <SermonsListState scrollProps={scrollProps}>
                  {fallback}
                </SermonsListState>
              )}
            >
              <Suspense
                fallback={
                  <SermonsListState scrollProps={scrollProps}>
                    <View className="border-design-border bg-design-surface items-center rounded-[26px] border py-16">
                      <LoadingIndicator />
                    </View>
                  </SermonsListState>
                }
              >
                <SermonsContainer
                  fetchPolicy={fetchPolicy}
                  scrollProps={scrollProps}
                  topInset={layout.topInset}
                />
              </Suspense>
            </ErrorBoundaryWithRetry>
          )
        }
      </AnimatedHeader>
      {shortsEnabled ? (
        // Floats below the header, like the Home tab's campus banner.
        <View
          testID="sermons-shorts-switch"
          pointerEvents="box-none"
          style={{ top: layout.topOverlayOffset }}
          onLayout={({ nativeEvent }) => {
            setSwitchHeight(nativeEvent.layout.height);
          }}
          className="absolute w-full items-center"
        >
          <SermonsShortsSwitch
            value={mode}
            onChange={(next) => {
              headerScrollY.set(0);
              setMode(next);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
