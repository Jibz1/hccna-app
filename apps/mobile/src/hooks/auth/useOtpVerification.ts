import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { OtpStatus } from "@/ui/OtpInput.logic";

/** Long enough for the staggered success ring to finish tracing every slot. */
export const SUCCESS_HOLD_MS = 900;

export type OtpVerification = {
  status: OtpStatus;
  /** Verifies the code; resolves after the status has been updated. */
  submit: (code: string) => Promise<void>;
  /** Call on every edit so an error state clears once the user reacts to it. */
  handleChange: (code: string) => void;
};

type Options = {
  verify: (code: string) => Promise<unknown>;
  /** Fires after a success once the success animation has had time to play. */
  onVerified: () => void;
};

export function useOtpVerification({
  verify,
  onVerified,
}: Options): OtpVerification {
  const [status, setStatus] = useState<OtpStatus>("idle");
  const inFlight = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ verify, onVerified });
  useLayoutEffect(() => {
    latest.current = { verify, onVerified };
  }, [verify, onVerified]);

  useEffect(
    () => () => {
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
      }
    },
    [],
  );

  const submit = useCallback(async (code: string) => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setStatus("idle");
    try {
      await latest.current.verify(code);
      setStatus("success");
      holdTimer.current = setTimeout(() => {
        latest.current.onVerified();
      }, SUCCESS_HOLD_MS);
    } catch {
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }, []);

  const handleChange = useCallback(() => {
    setStatus((current) => (current === "error" ? "idle" : current));
  }, []);

  return { status, submit, handleChange };
}
