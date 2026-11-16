import { Environment, Network, RecordSource, Store } from "relay-runtime";
import { beforeEach, describe, expect, test, vi } from "vitest";

import profileQuery from "./__generated__/UserProfileQuery.graphql";

const { auth, fetchQuery } = vi.hoisted(() => ({
  auth: {
    currentUser: null as { uid: string } | null,
  },
  fetchQuery: vi.fn(),
}));

vi.mock("@react-native-firebase/auth", () => ({
  getAuth: () => auth,
}));

vi.mock("@/environment", async () => {
  const { atom } = await import("jotai");
  return {
    environmentAtom: atom(null),
  };
});

vi.mock("@/utils/relayPersistence", () => ({
  getRelayAuthScope: (uid?: string | null) => (uid ? `uid:${uid}` : "anon"),
}));

vi.mock("@/hooks/relay/useConnectivityAwareFetchPolicy", () => ({
  useConnectivityStatus: () => "online",
}));

vi.mock("react-relay", async () => ({
  fetchQuery,
  graphql: (strings: TemplateStringsArray) =>
    strings.join("").includes("query UserProfileQuery")
      ? profileQuery
      : strings.join(""),
  useRelayEnvironment: vi.fn(),
}));

function profileResponse(uid: string) {
  return {
    user: {
      profile: {
        uid,
      },
    },
  };
}

describe("ensureUserProfileQuery", () => {
  beforeEach(() => {
    auth.currentUser = { uid: "user-a" };
    fetchQuery.mockReset();
    vi.resetModules();
  });

  test("refetches when the authenticated UID changes on the same environment", async () => {
    const userAResponse = profileResponse("user-a");
    const userBResponse = profileResponse("user-b");
    fetchQuery
      .mockReturnValueOnce({
        toPromise: vi.fn(async () => userAResponse),
      })
      .mockReturnValueOnce({
        toPromise: vi.fn(async () => userBResponse),
      });
    const environment = new Environment({
      network: Network.create(async () => ({ data: userBResponse })),
      store: new Store(new RecordSource()),
    });
    const lookup = vi.spyOn(environment, "lookup");
    const { ensureUserProfileQuery } =
      await import("@/hooks/relay/useUserData");

    await expect(ensureUserProfileQuery(environment)).resolves.toMatchObject({
      uid: "user-a",
    });

    auth.currentUser = { uid: "user-b" };
    await expect(ensureUserProfileQuery(environment)).resolves.toMatchObject({
      uid: "user-b",
    });

    expect(fetchQuery).toHaveBeenCalledTimes(2);
    expect(lookup).not.toHaveBeenCalled();
  });
});
