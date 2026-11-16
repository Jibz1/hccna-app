interface Window {
  ReactNativeWebView?: {
    // postMessage is only defined if the onMessage prop is specified on the webview hence this being optional
    // See: https://github.com/react-native-webview/react-native-webview/blob/master/docs/Guide.md#the-windowreactnativewebviewpostmessage-method-and-onmessage-prop
    postMessage?: (message: string) => void;
  };
}
