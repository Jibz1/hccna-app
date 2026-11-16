import {
  interpolateColor,
  type SharedValue,
  useDerivedValue,
} from "react-native-reanimated";

type FeaturedEventProminentColors = {
  accent?: string | null;
  dark?: string | null;
  light?: string | null;
};

function resolveBackdropColor(
  colors: FeaturedEventProminentColors | undefined,
  fallbackColor: string,
) {
  const color =
    colors?.dark && colors.dark.length > 0 ? colors.dark : colors?.accent;

  return color && color.length > 0 ? color : fallbackColor;
}

export function useFeaturedEventBackdropColors(
  prominentColors: (FeaturedEventProminentColors | undefined)[],
  fallbackColor: string,
) {
  return prominentColors.map((colors) =>
    resolveBackdropColor(colors, fallbackColor),
  );
}

export function useAnimatedCarouselBackdropColor({
  colors,
  progress,
  fallbackColor,
}: {
  colors: string[];
  progress: SharedValue<number>;
  fallbackColor: string;
}) {
  const resolvedColors = colors.length > 0 ? colors : [fallbackColor];

  const outputRange = [...resolvedColors, resolvedColors[0] ?? fallbackColor];

  const inputRange: number[] = [];

  for (let index = 0; index < outputRange.length; index += 1) {
    inputRange.push(index);
  }

  return useDerivedValue(() => {
    if (resolvedColors.length === 1) {
      return resolvedColors[0] ?? fallbackColor;
    }

    // Loop progress keeps advancing beyond the first set of slides and can
    // become negative when swiping backward through the first slide.
    const colorCount = resolvedColors.length;
    const wrappedProgress =
      ((progress.get() % colorCount) + colorCount) % colorCount;

    return interpolateColor(wrappedProgress, inputRange, outputRange);
  });
}
