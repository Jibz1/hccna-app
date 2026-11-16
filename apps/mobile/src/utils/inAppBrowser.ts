import * as WebBrowser from "expo-web-browser";
import { Linking, Platform } from "react-native";

/** Opens a URL in the native in-app browser sheet (a new tab on web). */
export async function openInAppBrowser(url: string) {
  if (Platform.OS === "web") {
    await Linking.openURL(url);
    return;
  }

  await WebBrowser.openBrowserAsync(url, {
    dismissButtonStyle: "close",
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  });
}
