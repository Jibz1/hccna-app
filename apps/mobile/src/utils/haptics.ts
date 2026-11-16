import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export function successHaptic() {
  if (Platform.OS === "web") {
    return;
  }
  return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export function errorHaptic() {
  if (Platform.OS === "web") {
    return;
  }
  return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}
