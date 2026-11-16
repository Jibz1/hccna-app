import { Suspense, type ReactNode } from "react";
import { RelayEnvironmentProvider } from "react-relay";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  createOperationDescriptor,
  Environment,
  Network,
  RecordSource,
  Store,
} from "relay-runtime";
import { afterEach, expect, test, vi } from "vitest";

import { ErrorBoundaryWithRetry } from "@/components/providers/ErrorBoundaryWithRetry";
import type { ConnectivityAwareFetchPolicy } from "@/hooks/relay/useConnectivityAwareFetchPolicy";

import SermonsContainerQueryNode from "./__generated__/SermonsContainerQuery.graphql";
import { SermonsContainer } from "./SermonsContainer";

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
vi.mock("react-relay", async (importOriginal) => {
  const relay = await importOriginal<typeof import("react-relay")>();
  const query = (await import("./__generated__/SermonsContainerQuery.graphql"))
    .default;
  return { ...relay, graphql: () => query };
});
vi.mock("./SermonsItems", () => ({ SermonsItems: () => "Sermons" }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const sermonsPage = {
  sermons: {
    edges: [
      {
        cursor: "cursor-1",
        node: {
          __typename: "Sermon",
          id: "sample-sermon",
          slug: "sample-sermon",
          title: "Sample Sermon",
          thumbnail: null,
          speakerFullName: null,
          speakerImage: null,
          youtubeLink: "https://youtu.be/sample",
          pageName: "Sample Sermon",
        },
      },
    ],
    pageInfo: { hasNextPage: false, endCursor: "cursor-1" },
  },
};

/** An environment whose store already holds the tab's query, as after a persisted restore. */
function cachedEnvironment() {
  // Never answers, so anything rendered came from the store.
  const fetch = vi.fn(() => new Promise<never>(() => undefined));
  const environment = new Environment({
    network: Network.create(fetch),
    store: new Store(new RecordSource()),
  });
  environment.commitPayload(
    createOperationDescriptor(SermonsContainerQueryNode, {}),
    sermonsPage,
  );
  return { environment, fetch };
}

async function openSermonsTab(
  environment: Environment,
  fetchPolicy: ConnectivityAwareFetchPolicy,
) {
  await act(async () => {
    renderer = create(
      <RelayEnvironmentProvider environment={environment}>
        <ErrorBoundaryWithRetry>
          <Suspense fallback="Loading sermons">
            <SermonsContainer
              fetchPolicy={fetchPolicy}
              scrollProps={{}}
              topInset={0}
            />
          </Suspense>
        </ErrorBoundaryWithRetry>
      </RelayEnvironmentProvider>,
    );
  });
}

// The Relay store persists across launches, so a cache-first policy never
// fetched again and backend sermon changes only appeared after an account switch.
test("refetches cached sermons when the tab opens online", async () => {
  const { environment, fetch } = cachedEnvironment();

  await openSermonsTab(environment, "store-and-network");

  expect(renderer?.toJSON()).toBe("Sermons");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("shows cached sermons offline without a request", async () => {
  const { environment, fetch } = cachedEnvironment();

  await openSermonsTab(environment, "store-only");

  expect(renderer?.toJSON()).toBe("Sermons");
  expect(fetch).not.toHaveBeenCalled();
});
