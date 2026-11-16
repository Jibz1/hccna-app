export type OtpStatus = "idle" | "success" | "error";

export type OtpChange = {
  code: string;
  /** True when the change removed a digit, so the char should roll out downward. */
  cleared: boolean;
  complete: boolean;
};

/**
 * Turns a raw hidden-input value into the next code. The hidden input mirrors
 * the contiguous code, so a shorter string is a backspace, a longer one is a
 * typed digit or a paste, and a full-length block appended by SMS autofill
 * replaces whatever was typed so far.
 */
export function resolveOtpInput(
  previous: string,
  incoming: string,
  length: number,
): OtpChange {
  const digits = incoming.replace(/\D/g, "");
  const appended = digits.startsWith(previous);
  const isAutofillReplace =
    appended &&
    previous.length > 0 &&
    digits.length - previous.length === length;
  const code = (
    isAutofillReplace ? digits.slice(previous.length) : digits
  ).slice(0, length);

  return {
    code,
    cleared: code.length < previous.length,
    complete: code.length === length,
  };
}

/** Slot the caret sits in, or null when every slot is filled. */
export function caretIndexFor(code: string, length: number): number | null {
  return code.length < length ? code.length : null;
}
