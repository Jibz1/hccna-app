import * as Application from "expo-application";
import * as Device from "expo-device";
import { Platform } from "react-native";

const UNKNOWN_HEADER_VALUE = "unknown";

function getOsName(): string {
  if (Platform.OS === "ios") {
    return "iOS";
  }

  if (Platform.OS === "android") {
    return "Android";
  }

  return Platform.OS;
}

function getDeviceTypeHeaderValue(deviceType: Device.DeviceType): string {
  switch (deviceType) {
    case Device.DeviceType.PHONE:
      return "phone";
    case Device.DeviceType.TABLET:
      return "tablet";
    case Device.DeviceType.DESKTOP:
      return "desktop";
    case Device.DeviceType.TV:
      return "tv";
    case Device.DeviceType.UNKNOWN:
    default:
      return UNKNOWN_HEADER_VALUE;
  }
}

export async function getTelemetryHeaders(): Promise<Record<string, string>> {
  const deviceType = await Device.getDeviceTypeAsync();

  return {
    "x-hccna-app-version":
      Application.nativeApplicationVersion ?? UNKNOWN_HEADER_VALUE,
    "x-hccna-app-build": Application.nativeBuildVersion ?? UNKNOWN_HEADER_VALUE,
    "x-hccna-device-type": getDeviceTypeHeaderValue(deviceType),
    "x-hccna-device-model": Device.modelName ?? UNKNOWN_HEADER_VALUE,
    "x-hccna-os-name": getOsName(),
    "x-hccna-os-version": Device.osVersion ?? UNKNOWN_HEADER_VALUE,
  };
}
