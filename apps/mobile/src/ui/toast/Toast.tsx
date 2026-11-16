import { View } from "react-native";
import * as SonnerNative from "sonner-native";

import { ToastContent, type ToastProps } from "./ToastContent";

interface NativeToastProps extends ToastProps {
  options?: Parameters<typeof SonnerNative.toast.custom>[1];
}

type ToastOptions = {
  error: (props: NativeToastProps) => void;
  offline: (props: NativeToastProps) => void;
  online: (props: NativeToastProps) => void;
  success: (props: NativeToastProps) => void;
  notification: (props: NativeToastProps) => void;
};

function getToast({ title, message, preset, id, options }: NativeToastProps) {
  return SonnerNative.toast.custom(
    <View className="px-3xs">
      <ToastContent title={title} message={message} preset={preset} id={id} />
    </View>,
    { ...options, id },
  );
}

const error = ({ title, message, ...options }: NativeToastProps) => {
  getToast({ title, message, preset: "error", ...options });
};

const success = ({ title, message, ...options }: NativeToastProps) => {
  getToast({ title, message, preset: "done", ...options });
};

const offline = ({ title, message, ...options }: NativeToastProps) => {
  getToast({ title, message, preset: "offline", ...options });
};

const online = ({ title, message, ...options }: NativeToastProps) => {
  getToast({ title, message, preset: "online", ...options });
};

const notification = ({ title, message, ...options }: NativeToastProps) => {
  getToast({ title, message, preset: "notification", ...options });
};

export const toast: ToastOptions = {
  error,
  offline,
  online,
  success,
  notification,
};
