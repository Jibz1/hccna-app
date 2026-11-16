import { Predicate } from "effect";
type IdleTask = {
  readonly cancel: () => void;
};

type IdleScheduler = (
  callback: () => void,
  options?: { readonly timeout?: number },
) => number;

type IdleCanceller = (handle: number) => void;

type IdleGlobal = typeof globalThis & {
  readonly requestIdleCallback?: IdleScheduler;
  readonly cancelIdleCallback?: IdleCanceller;
};

export function scheduleIdleTask(
  task: () => void | Promise<void>,
  options: { readonly timeout?: number } = { timeout: 500 },
): IdleTask {
  let cancelled = false;
  const run = () => {
    if (!cancelled) {
      task()?.catch(() => undefined);
    }
  };

  const idleGlobal = globalThis as IdleGlobal;
  const requestIdleCallback = idleGlobal.requestIdleCallback;

  if (Predicate.isFunction(requestIdleCallback)) {
    const handle = requestIdleCallback(run, options);
    return {
      cancel: () => {
        cancelled = true;
        idleGlobal.cancelIdleCallback?.(handle);
      },
    };
  }

  const handle = setTimeout(run, 0);
  return {
    cancel: () => {
      cancelled = true;
      clearTimeout(handle);
    },
  };
}
