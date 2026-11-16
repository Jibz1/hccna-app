import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  Environment,
  Network,
  Observable,
  RecordSource,
  Store,
  createOperationDescriptor,
  fetchQuery,
  getRequest,
  type GraphQLResponse,
} from "relay-runtime";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import Query from "@/hooks/relay/__generated__/FeaturedEventsQuery.graphql";
import { useRefreshFeaturedEvents } from "@/hooks/relay/useFeaturedEvents";

const session = vi.hoisted(() => ({
  environment: undefined as Environment | undefined,
  online: true,
  toast: vi.fn(),
}));
vi.mock("sonner-native", () => ({ toast: { error: session.toast } }));
vi.mock("react-relay", async () => {
  const query = (await import("./__generated__/FeaturedEventsQuery.graphql"))
    .default;
  return {
    graphql: () => query,
    fetchQuery,
    useRelayEnvironment: () => session.environment,
    useLazyLoadQuery: vi.fn(),
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer;
let latest: ReturnType<typeof useRefreshFeaturedEvents>;
let requests: {
  sink: {
    next(value: GraphQLResponse): void;
    complete(): void;
    error(error: Error): void;
  };
  cancel: ReturnType<typeof vi.fn>;
}[];
const operation = createOperationDescriptor(getRequest(Query), {
  campusSlug: "edison",
});
function Probe() {
  const refreshState = useRefreshFeaturedEvents("edison", session.online);
  useEffect(() => {
    latest = refreshState;
  }, [refreshState]);
  return null;
}
const payload = (titles: string[]) => ({
  data: {
    featuredEvents: {
      __typename: "FeaturedEventsSuccess",
      events: titles.map((title) => ({
        eventTitle: title,
        description: "",
        eventImageUrl: "",
        pageLink: null,
        slug: title,
        prominentColors: {
          accent: "#000000",
          light: "#FFFFFF",
          dark: "#000000",
        },
      })),
    },
  },
});

beforeEach(async () => {
  requests = [];
  session.online = true;
  session.toast.mockClear();
  session.environment = new Environment({
    network: Network.create(() =>
      Observable.create((sink) => {
        const cancel = vi.fn();
        requests.push({ sink, cancel });
        return cancel;
      }),
    ),
    store: new Store(new RecordSource()),
  });
  session.environment.commitPayload(
    operation,
    payload(["Local", "Deleted shared"]).data,
  );
  await act(async () => {
    renderer = create(createElement(Probe));
  });
});
afterEach(async () => {
  await act(async () => {
    renderer.unmount();
  });
});

test("a refresh replaces the campus list, including a successfully empty list", async () => {
  await act(async () => {
    latest.refresh();
    latest.refresh();
  });
  expect(requests).toHaveLength(1);
  expect(latest.refreshing).toBe(true);
  await act(async () => {
    requests[0].sink.next(payload(["Local"]));
    requests[0].sink.complete();
  });
  expect(session.environment!.lookup(operation.fragment).data).toEqual(
    payload(["Local"]).data,
  );
  expect(latest.refreshing).toBe(false);
  await act(async () => {
    latest.refresh();
  });
  await act(async () => {
    requests[1].sink.next(payload([]));
    requests[1].sink.complete();
  });
  expect(session.environment!.lookup(operation.fragment).data).toEqual(
    payload([]).data,
  );
});

test("keeps cached events on transport failure and allows retry", async () => {
  await act(async () => {
    latest.refresh();
  });
  await act(async () => {
    requests[0].sink.error(new Error("offline"));
  });
  expect(session.environment!.lookup(operation.fragment).data).toEqual(
    payload(["Local", "Deleted shared"]).data,
  );
  expect(latest.refreshing).toBe(false);
  expect(session.toast).toHaveBeenCalledOnce();
  await act(async () => {
    latest.refresh();
  });
  expect(requests).toHaveLength(2);
});

test("does not fetch offline and cancels when the campus screen unmounts", async () => {
  session.online = false;
  await act(async () => {
    renderer.update(createElement(Probe));
  });
  await act(async () => {
    latest.refresh();
  });
  expect(requests).toHaveLength(0);
  session.online = true;
  await act(async () => {
    renderer.update(createElement(Probe));
  });
  await act(async () => {
    latest.refresh();
  });
  await act(async () => {
    renderer.unmount();
  });
  expect(requests[0].cancel).toHaveBeenCalledOnce();
});
