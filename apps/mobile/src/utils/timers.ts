/** Resolve after `ms`, or at once when `signal` aborts. Never rejects. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(id);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const id = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Run `run`; if it has not settled after `ms`, abort its signal and reject with
 * `onTimeout()`. The timer is cleared as soon as `run` settles.
 */
export function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  onTimeout: () => Error,
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => {
      controller.abort();
      reject(onTimeout());
    }, ms);
    Promise.resolve()
      .then(() => run(controller.signal))
      .then(
        (value) => {
          clearTimeout(id);
          resolve(value);
        },
        (error) => {
          clearTimeout(id);
          reject(error);
        },
      );
  });
}
