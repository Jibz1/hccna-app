import SvgCheck from "@/icons/Check";
import SvgNotificationOn from "@/icons/NotificationOn";
import SvgWifi from "@/icons/Wifi";
import SvgWifiOff from "@/icons/WifiOff";
import { Alert, AlertHeadline, AlertMessage } from "@/ui/Alerts";

export interface ToastProps {
  preset?: "done" | "error" | "notification" | "offline" | "online";
  title: string;
  message?: string;
  id?: string | number;
}

function getVariant(preset?: ToastProps["preset"]) {
  switch (preset) {
    case "error":
      return "negative";
    case "notification":
      return "notification";
    case "offline":
      return "neutral";
    default:
      return "positive";
  }
}

function getIcon(preset?: ToastProps["preset"]) {
  switch (preset) {
    case "done":
      return SvgCheck;
    case "notification":
      return SvgNotificationOn;
    case "online":
      return SvgWifi;
    case "offline":
      return SvgWifiOff;
    default:
      return undefined;
  }
}

export function ToastContent({ title, message, preset, id }: ToastProps) {
  return (
    <Alert
      id={id !== undefined ? String(id) : undefined}
      rounded="xl"
      customIcon={getIcon(preset)}
      variant={getVariant(preset)}
    >
      {title ? <AlertHeadline>{title}</AlertHeadline> : null}
      {message ? <AlertMessage>{message}</AlertMessage> : null}
    </Alert>
  );
}
