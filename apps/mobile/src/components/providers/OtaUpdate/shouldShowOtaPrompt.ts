import type { UpdateInfoType } from "expo-updates";

type OtaPromptState = {
  readonly isEnabled: boolean;
  readonly isUpdatePending: boolean;
  readonly downloadedUpdateType: `${UpdateInfoType}` | undefined;
  readonly isDismissed: boolean;
};

// Only a downloaded new update earns a prompt. A roll-back-to-embedded
// directive also reports as pending, but it applies on the next launch
// without asking, so users are not prompted again after every rollback.
export const shouldShowOtaPrompt = ({
  isEnabled,
  isUpdatePending,
  downloadedUpdateType,
  isDismissed,
}: OtaPromptState) =>
  isEnabled &&
  isUpdatePending &&
  downloadedUpdateType === "new" &&
  !isDismissed;
