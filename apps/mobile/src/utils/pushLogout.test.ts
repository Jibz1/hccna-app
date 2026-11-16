import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GraphQLNetworkRequest } from "@/effect/graphqlNetworkService";

import { pushLogoutStore, syncPushLogout } from "./pushLogout";

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  online: true,
  uid: "user" as string | undefined,
  request: vi.fn(),
  key: 0,
}));
vi.mock("@react-native-firebase/auth", () => ({
  getAuth: () => ({ currentUser: mocks.uid ? { uid: mocks.uid } : null }),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => `key-${++mocks.key}` }));
vi.mock("relay-runtime", () => ({
  graphql: () => ({}),
  getRequest: () => ({
    params: { name: "PushTokensUnregisterPushTokenMutation" },
  }),
}));
vi.mock("@/effect/appRuntimeLive", () => ({
  runLiveAppEffect: (request: GraphQLNetworkRequest) => mocks.request(request),
}));
vi.mock("@/effect/graphqlNetworkService", () => ({
  executeGraphQLRequest: (request: GraphQLNetworkRequest) => request,
}));
vi.mock("@/effect/connectivity", () => ({
  connectivity: { getSnapshot: () => (mocks.online ? "online" : "offline") },
}));
vi.mock("@/utils/mmkv", () => ({
  pushLogoutStorage: {
    getString: (key: string) => mocks.storage.get(key),
    set: (key: string, value: string) => {
      mocks.storage.set(key, value);
    },
  },
}));
vi.mock("@/utils/pushTokenRegistrationStore", () => ({
  pushTokenRegistrationStore: { get: () => null },
}));

beforeEach(() => {
  mocks.storage.clear();
  mocks.online = true;
  mocks.uid = "user";
  vi.clearAllMocks();
  mocks.request.mockImplementation(async (request) => {
    request.sink.next({ data: { unregisterPushToken: true } });
  });
});
afterEach(() => vi.useRealTimers());

function queue() {
  pushLogoutStore.keyFor("token", "user");
  pushLogoutStore.retire("user");
}

describe("push logout delivery", () => {
  it("retains offline cleanup and retries without the previous Firebase user", async () => {
    queue();
    mocks.online = false;
    await syncPushLogout();
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.online = true;
    mocks.uid = undefined;
    await syncPushLogout();
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(pushLogoutStore.pending()).toEqual([]);
  });
  it("retains cleanup on an application rejection instead of treating HTTP success as cleanup", async () => {
    queue();
    mocks.request.mockImplementation(async (request) => {
      request.sink.next({ data: { unregisterPushToken: false } });
    });
    await expect(syncPushLogout()).rejects.toThrow();
    expect(pushLogoutStore.pending()).toHaveLength(1);
  });
  it("bounds a stalled request and keeps it for retry", async () => {
    vi.useFakeTimers();
    queue();
    mocks.request.mockImplementation(
      (request) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => {
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    );
    const failure = expect(syncPushLogout()).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(3_000);
    await failure;
    expect(pushLogoutStore.pending()).toHaveLength(1);
  });
});
