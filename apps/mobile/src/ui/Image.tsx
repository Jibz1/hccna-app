import { useObservable, useValue } from "@legendapp/state/react";
import { cva, VariantProps } from "class-variance-authority";
import { ImageProps as ExpoImageProps } from "expo-image";
import { View } from "react-native";

import { StyledImage as ExpoImage } from "@/cssInterop";
import { Text } from "@/ui/Text";

const imageContainerStyles = cva(
  "justify-center items-center overflow-hidden",
  {
    variants: {
      size: {
        "2xs": "size-2xs",
        xs: "size-xs",
        s: "size-s",
        m: "size-m",
        l: "size-l",
        xl: "size-xl",
        "2xl": "size-2xl",
        "3xl": "size-3xl",
        "5xl": "size-5xl",
        full: "size-full",
        none: "",
      },
      rounded: {
        xs: "rounded-xs",
        m: "rounded-m",
        full: "rounded-full",
        none: "",
      },
    },
    defaultVariants: {
      size: "l",
      rounded: "m",
    },
  },
);

export interface ImageProps
  extends
    Omit<ExpoImageProps, "source">,
    VariantProps<typeof imageContainerStyles> {
  src: ExpoImageProps["source"];
  fallback?: string;
  contentFit?: ExpoImageProps["contentFit"];
}

export function Image({
  src,
  fallback,
  alt,
  size,
  contentFit = "cover",
  rounded,
  className,
  ...rest
}: ImageProps) {
  const error$ = useObservable(false);
  const error = useValue(error$);

  return (
    <View className={imageContainerStyles({ size, rounded, className })}>
      {error && fallback ? (
        <Text variant="p/regular" transform="capitalize">
          {fallback.slice(0, 2)}
        </Text>
      ) : (
        <ExpoImage
          className="h-full w-full"
          onError={() => {
            error$.set(true);
          }}
          source={src}
          alt={alt ?? fallback}
          contentFit={contentFit}
          {...rest}
        />
      )}
    </View>
  );
}
