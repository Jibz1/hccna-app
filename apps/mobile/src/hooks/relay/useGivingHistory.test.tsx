import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  Environment,
  Network,
  Observable,
  RecordSource,
  Store,
  fetchQuery,
} from "relay-runtime";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useGivingHistory } from "@/hooks/relay/useUserData";

const session = vi.hoisted(() => ({
  environment: undefined as Environment | undefined,
  uid: "member",
  connectivity: "online",
}));
vi.mock("@react-native-firebase/auth", () => ({
  getAuth: () => ({ currentUser: { uid: session.uid } }),
}));
vi.mock("jotai", () => ({
  useAtomValue: () => ({ authScope: `uid:${session.uid}` }),
}));
vi.mock("@/environment", () => ({ environmentAtom: {} }));
vi.mock("@/utils/relayPersistence", () => ({
  getRelayAuthScope: (uid: string) => `uid:${uid}`,
}));
vi.mock("@/hooks/relay/useConnectivityAwareFetchPolicy", () => ({
  useConnectivityStatus: () => session.connectivity,
}));
vi.mock("react-relay", async () => {
  const [
    { default: givingQuery },
    { default: profileQuery },
    { default: woaQuery },
  ] = await Promise.all([
    import("./__generated__/UserGivingQuery.graphql"),
    import("./__generated__/UserProfileQuery.graphql"),
    import("./__generated__/UserWoaQuery.graphql"),
  ]);
  return {
    fetchQuery,
    graphql: (strings: TemplateStringsArray) => {
      const text = strings.join("");
      return text.includes("UserGivingQuery")
        ? givingQuery
        : text.includes("UserProfileQuery")
          ? profileQuery
          : woaQuery;
    },
    useRelayEnvironment: () => session.environment,
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer;
let latest: ReturnType<typeof useGivingHistory>;
let sink: {
  next: (value: never) => void;
  complete: () => void;
  error: (error: Error) => void;
};
function newEnvironment() {
  return new Environment({
    network: Network.create(() =>
      Observable.create((observer) => {
        sink = observer;
      }),
    ),
    store: new Store(new RecordSource()),
  });
}
function Probe() {
  const history = useGivingHistory();
  useEffect(() => {
    latest = history;
  }, [history]);
  return null;
}
async function reply(history: {
  __typename: string;
  years?: readonly object[];
  message?: string;
}) {
  await act(async () => {
    sink.next({ data: { myGivingHistory: history } } as never);
    sink.complete();
  });
}
const success = {
  __typename: "MyGivingHistorySuccess",
  years: [
    {
      year: 2026,
      ccbId: "member",
      total: 25,
      numberOfGiving: 1,
      giving: [],
      groupGivingByMonth: [],
    },
  ],
};
beforeEach(async () => {
  session.uid = "member";
  session.connectivity = "online";
  session.environment = newEnvironment();
  await act(async () => {
    renderer = create(createElement(Probe));
  });
});
afterEach(() => {
  act(() => {
    renderer?.unmount();
  });
});

test("retains successful history after a union failure but clears it on account transition", async () => {
  await reply(success);
  await act(async () => {
    latest.retry();
  });
  await reply({
    __typename: "MyGivingHistoryFetchError",
    message: "Unavailable",
  });
  expect(latest.status).toBe("error");
  expect(latest.years[0]?.total).toBe(25);
  session.uid = "other";
  session.environment = newEnvironment();
  await act(async () => {
    renderer.update(createElement(Probe));
  });
  expect(latest.years).toEqual([]);
  expect(latest.status).toBe("loading");
});
