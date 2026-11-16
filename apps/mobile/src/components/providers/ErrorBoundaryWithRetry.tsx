import { ErrorBoundary } from "@sentry/react-native";
import {
  createContext,
  Fragment,
  ReactNode,
  use,
  useEffect,
  useId,
  useState,
} from "react";

import { FeedbackCard } from "@/components/design-v2/FeedbackCard";
import SvgWarningTriangular from "@/icons/WarningTriangular";
import { useAppTheme } from "@/theme/useAppTheme";

const RetryKeyProvider = createContext<{
  retryKey: number;
  scope: string;
} | null>(null);

export function useRetryKey(prefix: string | number = "") {
  const context = use(RetryKeyProvider);
  if (!context) {
    throw new Error("useRetryKey must be used within a RetryKeyProvider");
  }
  return `${prefix}-${context.scope}-${context.retryKey}`;
}

function ErrorFallbackWithRetry({
  title = "Something went wrong",
  subtitle,
  onRetry,
  className,
  isRetrying = false,
  cooldownTime = 0,
}: {
  title?: string;
  subtitle?: string;
  onRetry: () => void;
  className?: string;
  isRetrying?: boolean;
  cooldownTime?: number;
}) {
  const { colors } = useAppTheme();
  const buttonText =
    isRetrying && cooldownTime > 0
      ? `Try again in ${Math.ceil(cooldownTime)}s`
      : "Try again";

  return (
    <FeedbackCard
      title={title}
      message={subtitle}
      icon=<SvgWarningTriangular width={24} height={24} color={colors.accent} />
      actionLabel={buttonText}
      onAction={onRetry}
      disabled={isRetrying}
      className={className}
    />
  );
}

const BACKOFF_DELAYS = [1, 2, 4, 8, 16, 30];
const INITIAL_RETRY_STATE = { isRetrying: false, cooldownTime: 0 };

function getBackoffDelay(count: number) {
  const index = Math.min(count, BACKOFF_DELAYS.length - 1);
  return BACKOFF_DELAYS[index] * 1000;
}

export function ErrorBoundaryWithRetry({
  children,
  title,
  subtitle,
  fallbackClassName,
  fallbackContainer: Container = Fragment,
  fallbackRender,
  onRetry,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  fallbackClassName?: string;
  fallbackContainer?: ({ children }: { children: ReactNode }) => ReactNode;
  fallbackRender?: (fallback: ReactNode) => ReactNode;
  /**
   * Optional additional callback to call when retrying.
   */
  onRetry?: () => void;
}) {
  // Relay retains failed query resources after unmount. A new boundary must
  // not reuse the failed fetch key from an earlier visit (or another screen).
  const scope = useId();
  const [retryKey, setRetryKey] = useState(0);
  const [{ isRetrying, cooldownTime }, setRetryState] =
    useState(INITIAL_RETRY_STATE);

  const handleRetry = () => {
    if (isRetrying) {
      return;
    }

    const delay = getBackoffDelay(retryKey);
    setRetryState({ isRetrying: true, cooldownTime: delay / 1000 });
    setRetryKey((prev) => prev + 1);
    onRetry?.();
  };

  useEffect(() => {
    if (!isRetrying) {
      return;
    }

    const interval = setInterval(() => {
      setRetryState((current) => {
        const remainingSeconds = Math.max(0, current.cooldownTime - 1);
        return {
          isRetrying: remainingSeconds > 0,
          cooldownTime: remainingSeconds,
        };
      });
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [isRetrying]);

  return (
    <RetryKeyProvider.Provider value={{ retryKey, scope }}>
      <ErrorBoundary
        fallback={(props) => {
          const fallback = (
            <ErrorFallbackWithRetry
              title={title}
              subtitle={subtitle}
              className={fallbackClassName}
              isRetrying={isRetrying}
              cooldownTime={cooldownTime}
              onRetry={() => {
                handleRetry();
                props.resetError();
              }}
            />
          );

          return (
            <>
              {fallbackRender ? (
                fallbackRender(fallback)
              ) : (
                <Container>{fallback}</Container>
              )}
            </>
          );
        }}
      >
        {children}
      </ErrorBoundary>
    </RetryKeyProvider.Provider>
  );
}
