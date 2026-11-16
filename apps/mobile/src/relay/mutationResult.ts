export type MutationResultPayload =
  | { readonly success?: boolean | null; readonly message?: string | null }
  | null
  | undefined;

export class MutationFailedError extends Error {
  override readonly name = "MutationFailedError";
}

/** Throws MutationFailedError unless there are no GraphQL errors and `payload.success === true`. */
export function assertMutationSucceeded(
  payload: MutationResultPayload,
  errors: readonly { readonly message: string }[] | null | undefined,
  fallbackMessage: string,
): void {
  const firstError = errors?.[0];
  if (firstError) {
    throw new MutationFailedError(firstError.message);
  }
  if (payload?.success !== true) {
    throw new MutationFailedError(payload?.message ?? fallbackMessage);
  }
}
