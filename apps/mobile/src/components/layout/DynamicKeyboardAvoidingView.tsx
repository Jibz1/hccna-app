import { useEffect, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  KeyboardAvoidingViewProps,
  Platform,
  StatusBar,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function DynamicKeyboardAvoidingView(props: KeyboardAvoidingViewProps) {
  const dimensions = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(() =>
    Keyboard.isVisible(),
  );
  const [screenHeight, setScreenHeight] = useState(0);

  let navBarOffset = 0;
  // NOTE: https://github.com/facebook/react-native/issues/41918
  if (Platform.OS === "android" && StatusBar.currentHeight) {
    navBarOffset = StatusBar.currentHeight;
  }

  let modalOffsetFromTop = dimensions.height - screenHeight + navBarOffset;

  if (Platform.OS === "ios") {
    modalOffsetFromTop -= insets.bottom;
  }

  useEffect(() => {
    // It might seem like we can just use Keyboard.isVisible() to
    // conditionally set the KeyboardAvoidingView behavior below, but doing
    // so actually seems to cause a lag when the keyboard state changes (so
    // keyboard will close, wait a beat, then the extra padding disappears).
    // Doing it with event listeners makes the change more immediate.
    const keyboardDidShowListener = Keyboard.addListener(
      "keyboardDidShow",
      () => {
        setKeyboardVisible(true);
      },
    );
    const keyboardDidHideListener = Keyboard.addListener(
      "keyboardDidHide",
      () => {
        setKeyboardVisible(false);
      },
    );

    return () => {
      keyboardDidShowListener.remove();
      keyboardDidHideListener.remove();
    };
  }, []);

  return (
    <View
      className="flex-1"
      onLayout={(event) => {
        setScreenHeight(event.nativeEvent.layout.height);
      }}
    >
      {screenHeight ? (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={keyboardVisible ? "padding" : undefined}
          keyboardVerticalOffset={modalOffsetFromTop}
          {...props}
        />
      ) : null}
    </View>
  );
}
