import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncMutationCallbacks<TData> = {
  readonly onError?: (error: Error) => void;
  readonly onSettled?: (data: TData | undefined, error: Error | null) => void;
  readonly onSuccess?: (data: TData) => void;
};

export type AsyncMutationOptions<TData, TVariables> =
  AsyncMutationCallbacks<TData> & {
    readonly mutationFn: (variables: TVariables) => Promise<TData>;
  };

export function useAsyncMutation<TData, TVariables = void>({
  mutationFn,
  onError,
  onSettled,
  onSuccess,
}: AsyncMutationOptions<TData, TVariables>) {
  const mounted = useRef(true);
  const pendingCount = useRef(0);
  const [data, setData] = useState<TData>();
  const [error, setError] = useState<Error | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const mutateAsync = useCallback(
    async (
      variables: TVariables,
      callbacks?: AsyncMutationCallbacks<TData>,
    ): Promise<TData> => {
      pendingCount.current += 1;
      if (mounted.current) {
        setIsPending(true);
        setError(null);
      }

      try {
        let result: TData;
        try {
          result = await mutationFn(variables);
        } catch (cause) {
          const nextError =
            cause instanceof Error ? cause : new Error("Operation failed");
          if (mounted.current) {
            setError(nextError);
          }
          try {
            onError?.(nextError);
            callbacks?.onError?.(nextError);
          } finally {
            onSettled?.(undefined, nextError);
            callbacks?.onSettled?.(undefined, nextError);
          }
          throw nextError;
        }

        if (mounted.current) {
          setData(result);
        }
        try {
          onSuccess?.(result);
          callbacks?.onSuccess?.(result);
        } finally {
          onSettled?.(result, null);
          callbacks?.onSettled?.(result, null);
        }
        return result;
      } finally {
        pendingCount.current -= 1;
        if (mounted.current && pendingCount.current === 0) {
          setIsPending(false);
        }
      }
    },
    [mutationFn, onError, onSettled, onSuccess],
  );

  const mutate = useCallback(
    (
      variables: TVariables,
      callbacks?: AsyncMutationCallbacks<TData>,
    ): void => {
      void mutateAsync(variables, callbacks).catch(() => undefined);
    },
    [mutateAsync],
  );

  return {
    data,
    error,
    isPending,
    mutate,
    mutateAsync,
  };
}
