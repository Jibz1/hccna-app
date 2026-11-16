import { Suspense, type ReactNode } from "react";
import { RelayEnvironmentProvider, useLazyLoadQuery } from "react-relay";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Environment, Network, RecordSource, Store } from "relay-runtime";
import { afterEach, expect, test, vi } from "vitest";

import type { CampusesQuery } from "@/hooks/relay/__generated__/CampusesQuery.graphql";
import CampusesQueryNode from "@/hooks/relay/__generated__/CampusesQuery.graphql";

import { ErrorBoundaryWithRetry, useRetryKey } from "./ErrorBoundaryWithRetry";

vi.mock("@sentry/react-native", async () => {
  const { ErrorBoundary } = await import("react-error-boundary");
  return {
    ErrorBoundary: ({
      children,
      fallback,
    }: {
      children: ReactNode;
      fallback: (props: { resetError: () => void }) => ReactNode;
    }) => (
      <ErrorBoundary
        fallbackRender={({ resetErrorBoundary }) =>
          fallback({ resetError: resetErrorBoundary })
        }
      >
        {children}
      </ErrorBoundary>
    ),
  };
});
vi.mock("@/components/design-v2/FeedbackCard", () => ({
  FeedbackCard: "FeedbackCard",
}));
vi.mock("@/theme/useAppTheme", () => ({
  useAppTheme: () => ({ colors: { accent: "orange" } }),
}));
vi.mock("@/icons/WarningTriangular", () => ({ default: "WarningIcon" }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
});

function CampusScreen() {
  const fetchKey = useRetryKey("store-and-network");
  const data = useLazyLoadQuery<CampusesQuery>(
    CampusesQueryNode,
    { preferredCampus: "house-of-stars" },
    { fetchKey, fetchPolicy: "store-and-network" },
  );
  return data.campusesV2?.__typename;
}

test("reopening a recovered campus screen does not resurrect its first failed request", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Network request failed"))
    .mockResolvedValue({
      data: { campusesV2: { __typename: "CampusesSuccess", campuses: [] } },
    });
  const environment = new Environment({
    network: Network.create(fetch),
    store: new Store(new RecordSource()),
  });
  const tree = (
    <RelayEnvironmentProvider environment={environment}>
      <ErrorBoundaryWithRetry>
        <Suspense fallback="Loading campuses">
          <CampusScreen />
        </Suspense>
      </ErrorBoundaryWithRetry>
    </RelayEnvironmentProvider>
  );
  await act(async () => {
    renderer = create(tree);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    renderer!.root.findByProps({ actionLabel: "Try again" }).props.onAction();
  });
  expect(renderer!.toJSON()).toBe("CampusesSuccess");
  expect(fetch).toHaveBeenCalledTimes(2);

  await act(async () => {
    renderer!.unmount();
  });
  await act(async () => {
    renderer = create(tree);
  });
  expect(renderer!.toJSON()).toBe("CampusesSuccess");
  expect(fetch).toHaveBeenCalledTimes(3);
});
