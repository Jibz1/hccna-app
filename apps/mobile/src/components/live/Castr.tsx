import { useState } from "react";
import { useWindowDimensions, View, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

import { StyledImage as Image } from "@/cssInterop";

type CastrProps = {
  streamLink?: string;
  image: string;
};

function CastrPlayer({ streamLink, image }: CastrProps) {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <View className="relative h-full w-full overflow-hidden">
      {streamLink ? (
        <WebView
          style={styles.webView}
          source={{
            uri: `${streamLink}?abr=false&namedHls=true&vq=1080&amp;autoplay=0&amp;autohide=1&amp;controls=1&amp;showinfo=1&amp;rel=0`,
          }}
          javaScriptEnabled
          onLoadEnd={() => {
            setIsLoading(false);
          }}
          onLoadStart={() => {
            setIsLoading(true);
          }}
          onError={() => {
            setIsLoading(false);
          }}
          width="100%"
          scalesPageToFit
          startInLoadingState
          domStorageEnabled
          allowsFullscreenVideo
          webkitallowfullscreen
          mediaPlaybackRequiresUserAction={false}
          mixedContentMode="compatibility"
          thirdPartyCookiesEnabled={false}
          sharedCookiesEnabled={false}
        />
      ) : null}
      {isLoading || !streamLink ? (
        <Image
          pointerEvents="none"
          cachePolicy="disk"
          source={image}
          alt="Campus stream preview"
          contentFit="cover"
          className="absolute inset-0"
        />
      ) : null}
    </View>
  );
}

function CastrHero({ streamLink, image }: CastrProps) {
  const { height } = useWindowDimensions();
  const heroHeight = Math.min(height * 0.4, 480);

  return (
    <View
      className="bg-content-persistentBlack px-4xs relative w-full items-center justify-center overflow-hidden rounded-b-lg"
      style={{ height: heroHeight }}
    >
      <View
        className="rounded-t-m relative z-50 aspect-video w-full overflow-hidden rounded-lg"
        style={{ maxWidth: heroHeight * (16 / 9) }}
      >
        <CastrPlayer key={streamLink} streamLink={streamLink} image={image} />
      </View>
      <View pointerEvents="none" className="absolute inset-0 opacity-60">
        <Image
          className="h-full w-full"
          cachePolicy="disk"
          source={image}
          alt="preview"
          contentFit="cover"
          blurRadius={50}
          contentPosition="top"
          transition={250}
        />
      </View>
    </View>
  );
}

export function Castr({
  presentation = "hero",
  ...props
}: CastrProps & { presentation?: "hero" | "fullWidth" }) {
  if (presentation === "fullWidth") {
    return (
      <View className="bg-content-persistentBlack aspect-video w-full overflow-hidden">
        <CastrPlayer key={props.streamLink} {...props} />
      </View>
    );
  }

  return <CastrHero {...props} />;
}

const styles = StyleSheet.create({
  webView: { flex: 1, backgroundColor: "black" },
});
