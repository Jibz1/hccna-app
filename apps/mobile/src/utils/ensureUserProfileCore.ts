export type EnsureUserProfileOutcome = {
  readonly success: boolean;
  readonly created: boolean;
  readonly message: string;
};

export class EnsureUserProfileError extends Error {
  override readonly name = "EnsureUserProfileError";
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wraps the ensureUserProfile mutation commit with a single retry. The
 * mutation is idempotent server-side, so retrying is always safe. Kept free
 * of react-relay imports so vitest (no Relay babel plugin) can test it.
 */
export function createEnsureUserProfile(
  commit: () => Promise<EnsureUserProfileOutcome>,
  options: {
    retryDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): () => Promise<EnsureUserProfileOutcome> {
  const retryDelayMs = options.retryDelayMs ?? 1500;
  const sleep = options.sleep ?? defaultSleep;

  const attempt = async (): Promise<EnsureUserProfileOutcome> => {
    const outcome = await commit();
    if (!outcome.success) {
      throw new EnsureUserProfileError(
        outcome.message || "ensureUserProfile returned success: false",
      );
    }
    return outcome;
  };

  return async () => {
    try {
      return await attempt();
    } catch {
      await sleep(retryDelayMs);
      return await attempt();
    }
  };
}
