import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { ChipsCta } from "@/components/core/ChipsCta";
import { LiveStreamIndicator } from "@/components/live/LiveStreamIndicator";
import { useLiveStream } from "@/hooks/events/useEventLive";
import { useConnectivityStatus } from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import { usePreferredCampus } from "@/hooks/relay/usePreferredCampus";
import SvgWifiOff from "@/icons/WifiOff";

export function CampusStreamButton() {
  const { navigate } = useRouter();
  const connectivityStatus = useConnectivityStatus();
  const campus = usePreferredCampus();
  const { liveStream } = useLiveStream();
  const isLive =
    liveStream?.streams?.some(
      (stream) => stream.slug === campus.slug && stream.isLive,
    ) ?? false;
  const title = isLive ? "Live" : "Stream";
  const scale = useSharedValue(1);
  const previousIsLive = useRef(isLive);

  useEffect(() => {
    if (previousIsLive.current !== isLive) {
      scale.set(
        withSequence(
          ReduceMotion.System,
          withTiming(1.08, { duration: 180 }),
          withTiming(1, { duration: 280 }),
        ),
      );
    }
    previousIsLive.current = isLive;
    return () => {
      cancelAnimation(scale);
    };
  }, [isLive, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <ChipsCta
        title={title}
        accessibilityLabel={`${title} ${campus.campusName}`}
        variant="brand"
        icon={
          <View className="gap-6xs flex-row items-center">
            <LiveStreamIndicator isLive={isLive} />
            {connectivityStatus === "offline" ? (
              <SvgWifiOff
                accessibilityLabel="Offline"
                className="size-4xs"
                color="#FFFFFF"
                height={16}
                width={16}
              />
            ) : null}
          </View>
        }
        onPress={() => {
          navigate({
            pathname: "/campus-modal",
            params: { slug: campus.slug },
          });
        }}
      />
    </Animated.View>
  );
}
