import { describe, expect, it } from "vitest";

import { shouldShowOtaPrompt } from "./shouldShowOtaPrompt";

const pendingNewUpdate = {
  isEnabled: true,
  isUpdatePending: true,
  downloadedUpdateType: "new",
  isDismissed: false,
} as const;

describe("shouldShowOtaPrompt", () => {
  it("shows once a new update has downloaded", () => {
    expect(shouldShowOtaPrompt(pendingNewUpdate)).toBe(true);
  });

  it("stays hidden when updates are disabled, as in development builds", () => {
    expect(shouldShowOtaPrompt({ ...pendingNewUpdate, isEnabled: false })).toBe(
      false,
    );
  });

  it("stays hidden until the download finishes", () => {
    expect(
      shouldShowOtaPrompt({
        ...pendingNewUpdate,
        isUpdatePending: false,
        downloadedUpdateType: undefined,
      }),
    ).toBe(false);
  });

  // EAS reports a roll-back-to-embedded directive as an available update on
  // every launch; prompting for it would repeat after each rollback.
  it("lets rollbacks apply silently on the next launch", () => {
    expect(
      shouldShowOtaPrompt({
        ...pendingNewUpdate,
        downloadedUpdateType: "rollback",
      }),
    ).toBe(false);
  });

  it("stays hidden for the rest of the session after Later", () => {
    expect(
      shouldShowOtaPrompt({ ...pendingNewUpdate, isDismissed: true }),
    ).toBe(false);
  });
});
