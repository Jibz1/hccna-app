import { useEffect, useEffectEvent } from "react";

/**
 * Push a React value into a system outside React (a native module, a Reanimated
 * shared value, Uniwind). Runs after the first commit and after each commit where
 * `value` changed by `Object.is`. Never call a React state setter from `sync`.
 */
export function useExternalSync<T>(
  value: T,
  sync: (value: T) => void | (() => void),
): void {
  const run = useEffectEvent((next: T) => sync(next));
  useEffect(() => run(value), [value]);
}
