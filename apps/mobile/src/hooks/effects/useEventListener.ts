import { useEffect, useEffectEvent } from "react";

/**
 * Subscribe to an event source outside React for as long as the component is
 * mounted. `subscribe` must be a stable function (declare it at module scope);
 * the subscription is rebuilt only when its identity changes. `handler` is
 * always the latest one and never causes a resubscribe.
 */
export function useEventListener<Args extends readonly unknown[]>(
  subscribe: (listener: (...args: Args) => void) => () => void,
  handler: (...args: Args) => void,
): void {
  const onEvent = useEffectEvent((...args: Args) => {
    handler(...args);
  });
  useEffect(() => subscribe(onEvent), [subscribe]);
}
