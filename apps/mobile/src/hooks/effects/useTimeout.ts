import { useEffect, useEffectEvent } from "react";

/** Call `callback` once, `delayMs` after mount or after `delayMs`/`resetKey` change. `null` cancels. */
export function useTimeout(
  callback: () => void,
  delayMs: number | null,
  resetKey?: string | number | boolean,
): void {
  const onTimeout = useEffectEvent(() => {
    callback();
  });
  useEffect(() => {
    if (delayMs === null) {
      return undefined;
    }
    const id = setTimeout(onTimeout, delayMs);
    return () => {
      clearTimeout(id);
    };
  }, [delayMs, resetKey]);
}
