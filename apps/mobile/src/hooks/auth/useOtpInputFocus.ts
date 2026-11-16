import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

import type { OtpInputHandle } from "@/ui/OtpInput";
import { currentAppState } from "@/utils/appState";
import { scheduleIdleTask } from "@/utils/scheduleIdleTask";

export function useOtpInputFocus(enabled: boolean) {
  const inputRef = useRef<OtpInputHandle>(null);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) {
        return;
      }

      let focusTask: ReturnType<typeof scheduleIdleTask> | undefined;
      const handleAppState = (state: AppStateStatus) => {
        focusTask?.cancel();
        if (state === "active") {
          focusTask = scheduleIdleTask(() => inputRef.current?.focus());
        }
      };

      handleAppState(currentAppState());
      const subscription = AppState.addEventListener("change", handleAppState);

      return () => {
        subscription.remove();
        focusTask?.cancel();
      };
    }, [enabled]),
  );

  return inputRef;
}
