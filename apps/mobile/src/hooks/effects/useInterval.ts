import { useEffect, useEffectEvent } from "react";

/** Call `callback` every `delayMs`. `null` pauses. */
export function useInterval(
  callback: () => void,
  delayMs: number | null,
): void {
  const onTick = useEffectEvent(() => {
    callback();
  });
  useEffect(() => {
    if (delayMs === null) {
      return undefined;
    }
    const id = setInterval(onTick, delayMs);
    return () => {
      clearInterval(id);
    };
  }, [delayMs]);
}
