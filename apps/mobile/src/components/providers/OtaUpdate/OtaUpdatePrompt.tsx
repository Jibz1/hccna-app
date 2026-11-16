import * as Updates from "expo-updates";
import { useState } from "react";

import { ForceUpdateOverlay } from "@/components/providers/ForceUpdate/ForceUpdateOverlay";
import { captureException } from "@/utils/sentry";

import { shouldShowOtaPrompt } from "./shouldShowOtaPrompt";

const OTA_PROMPT_COPY = {
  title: "An update is ready",
  message:
    "Restart HCC to get the latest fixes and improvements. It only takes a moment.",
  updateButtonText: "Restart now",
  dismissButtonText: "Later",
};

/**
 * Offers to apply an OTA update that finished downloading in the background.
 * Declining is safe: the downloaded update launches on the next cold start.
 */
export function OtaUpdatePrompt() {
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const [isDismissed, setIsDismissed] = useState(false);

  if (
    !shouldShowOtaPrompt({
      isEnabled: Updates.isEnabled,
      isUpdatePending,
      downloadedUpdateType: downloadedUpdate?.type,
      isDismissed,
    })
  ) {
    return null;
  }

  const dismiss = () => {
    setIsDismissed(true);
  };
  const restart = () => {
    Updates.reloadAsync().catch((error: Error) => {
      captureException(error);
      dismiss();
    });
  };

  return (
    <ForceUpdateOverlay
      config={OTA_PROMPT_COPY}
      updateType="soft"
      actionIcon="rotate-right"
      readyNote={null}
      footnote="Otherwise it installs the next time you open HCC."
      onUpdate={restart}
      onDismiss={dismiss}
    />
  );
}
