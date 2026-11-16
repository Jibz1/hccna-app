import { useEffect, useState } from "react";
import { useErrorBoundary } from "react-error-boundary";

import { runLiveAppEffect } from "@/effect/appRuntimeLive";
import { startAppStartup } from "@/effect/appStartupService";
import { captureException } from "@/utils/sentry";

export function useBackgroundService(enabled = true) {
  const { showBoundary } = useErrorBoundary();
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let mounted = true;

    const start = async () => {
      try {
        await runLiveAppEffect(startAppStartup());
        if (mounted) {
          setStarted(true);
        }
      } catch (e) {
        console.warn("error", e);
        showBoundary(e);
        captureException(e);
      }
    };

    start().catch((e) => {
      showBoundary(e);
      captureException(e);
    });

    return () => {
      mounted = false;
    };
  }, [enabled, showBoundary]);

  return started;
}
