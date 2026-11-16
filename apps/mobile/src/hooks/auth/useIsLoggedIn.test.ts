import { getDefaultStore } from "jotai";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Environment, Network, RecordSource, Store } from "relay-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { environmentAtom } from "@/environment";
import { useIsLoggedIn } from "@/hooks/auth/useIsLoggedIn";
import type { RelayEnvironmentState } from "@/relay/relayEnvironmentLifecycle";

const mocks = vi.hoisted(() => ({
  authObserver: null as ((user: { uid: string } | null) => void) | null,
  clearUserData: vi.fn(async () => {}),
  currentUser: null as { uid: string; isAnonymous: boolean } | null,
  ensureUserProfile:
    vi.fn<
      (
        environment: Environment & { authScope?: string },
      ) => Promise<{ uid: string } | null>
    >(),
  unsubscribe: vi.fn(),
}));

vi.mock("@react-native-firebase/auth", () => ({
  getAuth: () => ({
    get currentUser() {
      return mocks.currentUser;
    },
  }),
  onAuthStateChanged: (
    _auth: { currentUser: { uid: string } | null },
    observer: (user: { uid: string } | null) => void,
  ) => {
    mocks.authObserver = observer;
    return mocks.unsubscribe;
  },
}));

vi.mock("@/environment", async () => {
  const { atom } = await import("jotai");
  return {
    environmentAtom: atom<{ authScope: string } | null>(null),
  };
});

vi.mock("@/hooks/relay/useUserData", () => ({
  ensureUserProfileQuery: mocks.ensureUserProfile,
}));

vi.mock("@/utils/pushLogout", () => ({ retirePushRegistration: vi.fn() }));
vi.mock("@/utils/sentry", () => ({ captureException: vi.fn() }));

vi.mock("@/utils/userData", () => ({
  clearUserData: mocks.clearUserData,
}));

vi.mock("@/utils/relayPersistence", () => ({
  ANONYMOUS_RELAY_AUTH_SCOPE: "anon",
  getRelayAuthScope: (uid?: string | null) => (uid ? `uid:${uid}` : "anon"),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const auth = useIsLoggedIn();
  return createElement("output", {
    "data-logged-in": auth.isLoggedIn,
    "data-auth-scope": auth.authScope,
  });
}

async function emitAuthenticatedUser(uid: string): Promise<void> {
  await act(async () => {
    mocks.currentUser = { uid, isAnonymous: false };
    mocks.authObserver?.(mocks.currentUser);
  });
}

async function setRelayAuthScope(authScope: string): Promise<void> {
  await act(async () => {
    const source = new RecordSource();
    const store = new Store(source);
    const environment = Object.assign(
      new Environment({
        network: Network.create(async () => ({ data: {} })),
        store,
      }),
      { authScope },
    );
    const state: RelayEnvironmentState = {
      authScope,
      environment,
      source,
      store,
      persistenceEnabled: false,
      dispose: () => {},
    };
    getDefaultStore().set(environmentAtom, state);
  });
}

describe("useIsLoggedIn profile refresh", () => {
  let renderer: ReactTestRenderer | null;

  beforeEach(async () => {
    renderer = null;
    mocks.authObserver = null;
    mocks.currentUser = null;
    vi.clearAllMocks();
    getDefaultStore().set(environmentAtom, null);

    await act(async () => {
      renderer = create(createElement(Probe));
    });
  });

  afterEach(async () => {
    await act(async () => {
      renderer?.unmount();
    });
    getDefaultStore().set(environmentAtom, null);
  });

  it("stays signed out when public requests create an anonymous Firebase session", async () => {
    await setRelayAuthScope("uid:deleted-user");
    mocks.ensureUserProfile.mockResolvedValue({ uid: "deleted-user" });
    await emitAuthenticatedUser("deleted-user");
    expect(mocks.ensureUserProfile).toHaveBeenCalledOnce();
    mocks.ensureUserProfile.mockClear();
    await act(async () => {
      mocks.currentUser = { uid: "anonymous-user", isAnonymous: true };
      mocks.authObserver?.(mocks.currentUser);
    });
    expect(renderer?.root.findByType("output").props["data-logged-in"]).toBe(
      false,
    );
    expect(renderer?.root.findByType("output").props["data-auth-scope"]).toBe(
      "anon",
    );
    expect(mocks.clearUserData).toHaveBeenCalledOnce();
    expect(mocks.ensureUserProfile).not.toHaveBeenCalled();
  });
});
