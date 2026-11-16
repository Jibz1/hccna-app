import LottieView from "lottie-react-native";
import type { Ref } from "react";
import { type HostInstance, StyleSheet, View, ViewProps } from "react-native";
// import Animated, {
//   useSharedValue,
//   useAnimatedStyle,
//   withRepeat,
//   withTiming,
//   cancelAnimation,
//   Easing,
// } from "react-native-reanimated";

// import Spinner from "@/icons/Spinner";
import { Text } from "@/ui/Text";
import { cn } from "@/utils/styling";

export interface LoadingIndicatorProps extends ViewProps {
  text?: string;
  spinnerClassName?: string;
}

// Memoized spinner component to prevent re-renders
// const AnimatedSpinner = memo(function AnimatedSpinner({
//   spinnerClassName,
// }: {
//   spinnerClassName?: string;
// }) {
//   const rotation = useSharedValue(0);

//   useEffect(() => {
//     rotation.value = withRepeat(
//       withTiming(360, {
//         duration: 1000,
//         easing: Easing.linear,
//       }),
//       -1, // infinite repeat
//       false, // don't reverse
//     );

//     // Cleanup: cancel animation on unmount to prevent memory leaks
//     return () => {
//       cancelAnimation(rotation);
//     };
//   }, [rotation]);

//   const animatedStyle = useAnimatedStyle(() => ({
//     transform: [{ rotate: `${rotation.value}deg` }],
//   }));

//   return (
//     <Animated.View className="justify-center" style={animatedStyle}>
//       <Spinner className={cn("text-content-tertiary", spinnerClassName)} />
//     </Animated.View>
//   );
// });

// export const LoadingIndicator1 = memo(
//   forwardRef<View, LoadingIndicatorProps>(
//     ({ text, className, spinnerClassName, ...props }, forwardedRef) => {
//       return (
//         <View
//           ref={forwardedRef}
//           className={cn("flex-row flex-nowrap items-center", className)}
//           {...props}
//         >
//           <AnimatedSpinner spinnerClassName={spinnerClassName} />

//           {text ? <Text>{text}</Text> : null}
//         </View>
//       );
//     },
//   ),
// );

export function LoadingIndicator({
  text,
  className,
  ref,
  ...props
}: LoadingIndicatorProps & { ref?: Ref<HostInstance> }) {
  return (
    <View
      ref={ref}
      className={cn("flex-row flex-nowrap items-center", className)}
      {...props}
    >
      <LottieView
        source={require("@/components/lottie/loading-animation.json")}
        autoPlay
        loop
        style={styles.spinner}
      />
      {text ? <Text>{text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  spinner: {
    width: 60,
    height: 60,
  },
});
