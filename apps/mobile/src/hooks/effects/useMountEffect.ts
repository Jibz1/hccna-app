import { useEffect, useEffectEvent } from "react";

/** Run once after the first commit; the returned function runs on unmount. */
export function useMountEffect(effect: () => void | (() => void)): void {
  const run = useEffectEvent(effect);
  useEffect(() => run(), []);
}
