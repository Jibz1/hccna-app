import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  Environment,
  Network,
  Observable,
  RecordSource,
  Store,
  fetchQuery,
  type GraphQLResponse,
} from "relay-runtime";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useProfileEnrichmentRefresh } from "@/hooks/relay/useProfileEnrichmentRefresh";
import { useUserProfile } from "@/hooks/relay/useUserData";

const session = vi.hoisted(() => ({
  environment: undefined as Environment | undefined,
  uid: "member" as string | undefined,
  active: true,
  connectivity: "online",
}));
vi.mock("@react-native-firebase/auth", () => ({
  getAuth: () => ({ currentUser: session.uid ? { uid: session.uid } : null }),
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
vi.mock("@/hooks/useIsAppActive", () => ({
  useIsAppActive: () => session.active,
}));
vi.mock("react-relay", async () => {
  const { default: profileQuery } =
    await import("./__generated__/UserProfileQuery.graphql");
  return {
    fetchQuery,
    graphql: (strings: TemplateStringsArray) =>
      strings.join("").includes("UserProfileQuery")
        ? profileQuery
        : strings.join(""),
    useRelayEnvironment: () => session.environment,
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer;
let latest: ReturnType<typeof useUserProfile>;
let requests: {
  sink: {
    next: (value: GraphQLResponse) => void;
    complete: () => void;
    error: (error: Error) => void;
  };
  cancel: ReturnType<typeof vi.fn>;
}[];

function newEnvironment() {
  return new Environment({
    network: Network.create(() =>
      Observable.create((sink) => {
        const cancel = vi.fn();
        requests.push({ sink, cancel });
        return cancel;
      }),
    ),
    store: new Store(new RecordSource()),
  });
}

function Probe() {
  useProfileEnrichmentRefresh();
  // A second profile consumer observes Relay updates without its own poller.
  const profile = useUserProfile();
  useEffect(() => {
    latest = profile;
  }, [profile]);
  return null;
}

async function render() {
  await act(async () => {
    renderer.update(createElement(Probe));
  });
}

async function advance(ms = 5_000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function reply(pending: boolean, firstName = "Hi", uid = session.uid) {
  await act(async () => {
    const request = requests.at(-1)!;
    request.sink.next({
      data: {
        user: {
          profile: {
            uid,
            enrichmentPending: pending,
            firstName,
            lastName: "There",
            email: `${uid}@example.com`,
            ccbId: pending ? null : "42",
            ccbFamilyId: null,
            createdAt: null,
            img: null,
            isVerified: true,
            phone: null,
            provider: "google",
            preferredCampusSlug: null,
            campusPreferenceVersion: 0,
            departments: [],
          },
        },
      },
    });
    request.sink.complete();
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  requests = [];
  session.uid = "member";
  session.active = true;
  session.connectivity = "online";
  session.environment = newEnvironment();
  await act(async () => {
    renderer = create(createElement(Probe));
  });
});

afterEach(() => {
  act(() => {
    renderer.unmount();
  });
  vi.useRealTimers();
});

test("updates an already open view and stops once enrichment completes", async () => {
  expect(requests).toHaveLength(1);
  await reply(true);
  expect(latest?.firstName).toBe("Hi");
  await advance();
  expect(requests).toHaveLength(2);
  await advance(30_000);
  expect(requests).toHaveLength(2); // Never overlap a slow request.
  await reply(false, "Ada");
  expect(latest).toMatchObject({
    firstName: "Ada",
    ccbId: "42",
    enrichmentPending: false,
  });
  await advance(60_000);
  expect(requests).toHaveLength(2);
});

test("pauses offline and in the background, cancelling in-flight requests", async () => {
  await reply(true);
  await advance();
  const pending = requests.at(-1)!;
  session.active = false;
  await render();
  expect(pending.cancel).toHaveBeenCalledOnce();
  await advance(60_000);
  expect(requests).toHaveLength(2);
  session.active = true;
  session.connectivity = "offline";
  await render();
  await advance(60_000);
  expect(requests).toHaveLength(2);
  session.connectivity = "online";
  await render();
  await advance();
  expect(requests).toHaveLength(3);
  await reply(false, "Ada");
  expect(latest?.firstName).toBe("Ada");
});

test("retries a failed refresh while retaining the base profile", async () => {
  await reply(true);
  await advance();
  await act(async () => {
    requests.at(-1)!.sink.error(new Error("temporarily unavailable"));
  });
  expect(latest?.firstName).toBe("Hi");
  await advance();
  expect(requests).toHaveLength(3);
  await reply(false, "Ada");
  expect(latest?.firstName).toBe("Ada");
});

test("continues a pending refresh after a temporary null profile response", async () => {
  await reply(true);
  await advance();
  await act(async () => {
    requests.at(-1)!.sink.next({ data: { user: { profile: null } } });
    requests.at(-1)!.sink.complete();
  });
  await advance();
  expect(requests).toHaveLength(3);
  await reply(false, "Ada");
  expect(latest?.firstName).toBe("Ada");
});

test("does not issue a request if auth changes before React renders", async () => {
  await reply(true);
  session.uid = "other";
  await advance();
  expect(requests).toHaveLength(1);
});

test("cancels on account changes and unmount without publishing an old response", async () => {
  await reply(true);
  await advance();
  const oldRequest = requests.at(-1)!;
  session.uid = "other";
  session.environment = newEnvironment();
  await render();
  expect(oldRequest.cancel).toHaveBeenCalledOnce();
  expect(latest).toBeNull();
  await reply(true, "Other");
  await act(async () => {
    oldRequest.sink.next({
      data: { user: { profile: { uid: "member", firstName: "Wrong" } } },
    });
  });
  expect(latest?.firstName).toBe("Other");
  await advance();
  const newRequest = requests.at(-1)!;
  act(() => {
    renderer.unmount();
  });
  expect(newRequest.cancel).toHaveBeenCalledOnce();
});

test("signing out cancels pending refreshes", async () => {
  await reply(true);
  session.uid = undefined;
  await render();
  await advance(60_000);
  expect(requests).toHaveLength(1);
  expect(latest).toBeNull();
});

test("caps polling across connectivity changes for jobs that never finish", async () => {
  await reply(true);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await advance();
    await reply(true);
  }
  expect(requests).toHaveLength(121);
  session.connectivity = "offline";
  await render();
  session.connectivity = "online";
  await render();
  await advance(60_000);
  expect(requests).toHaveLength(121);
});

test("does not poll a profile whose enrichment already completed", async () => {
  await reply(false, "Ada");
  await advance(60_000);
  expect(requests).toHaveLength(1);
});
