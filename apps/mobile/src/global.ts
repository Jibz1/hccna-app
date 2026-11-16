// Required for fast-refresh / hmr since we're not using expo router
// See: https://github.com/expo/expo/issues/23104#issuecomment-1689566248
import "@expo/metro-runtime";
import "react-native-gesture-handler";
import "expo-dev-client";
import * as ExpoCrypto from "expo-crypto";

if (!globalThis.Event) {
  // @ts-expect-error: W
  // but that global does not exist in React Native.
  globalThis.Event = class Event {};
}

if (!globalThis.AbortSignal.timeout) {
  globalThis.AbortSignal.timeout = (ms) => {
    const controller = new AbortController();
    const signal = controller.signal;
    setTimeout(() => {
      controller.abort();
    }, ms);
    return signal;
  };
}

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: ExpoCrypto,
  });
}
