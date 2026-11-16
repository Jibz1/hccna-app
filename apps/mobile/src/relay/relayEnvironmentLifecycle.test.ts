import {
  fetchQuery,
  Network,
  Observable,
  type GraphQLResponse,
} from "relay-runtime";
import { describe, expect, it, vi } from "vitest";

import FeaturedEventsQueryNode from "@/hooks/relay/__generated__/FeaturedEventsQuery.graphql";
import {
  createRelayEnvironmentState,
  resolveRelayEnvironmentState,
} from "@/relay/relayEnvironmentLifecycle";
import {
  getPersistedRelayAuthScope,
  MMKVRecordSource,
  type RelayStorageAdapter,
} from "@/utils/relayRecordSource";

class FakeStorage implements RelayStorageAdapter {
  private readonly values = new Map<string, string>();

  clearAll(): void {
    this.values.clear();
  }

  getAllKeys(): string[] {
    return Array.from(this.values.keys());
  }

  getString(key: string): string | undefined {
    return this.values.get(key);
  }

  remove(key: string): void {
    this.values.delete(key);
  }

  set(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function createNetwork() {
  return Network.create(() =>
    Observable.create(() => {
      return () => undefined;
    }),
  );
}

function createPersistedState(authScope: string, storage: RelayStorageAdapter) {
  return createRelayEnvironmentState({
    allowlist: {},
    authScope,
    cacheVersion: "1",
    createNetwork: () => createNetwork(),
    now: () => 100,
    persistenceEnabled: true,
    storage,
  });
}

describe("Relay environment lifecycle", () => {
  it("clears persisted records only after a different scope is resolved", () => {
    const storage = new FakeStorage();
    new MMKVRecordSource({
      authScope: "uid:user-a",
      cacheVersion: "1",
      storage,
    }).set("user:1", {
      __id: "user:1",
      __typename: "User",
      name: "User A",
    });

    const resolved = resolveRelayEnvironmentState({
      authScope: "uid:user-b",
      createEnvironment: (authScope) =>
        createPersistedState(authScope, storage),
      current: null,
      isAuthReady: true,
    });

    expect(resolved?.source.get("user:1")).toBeUndefined();
    expect(getPersistedRelayAuthScope(storage)).toBe("uid:user-b");
  });
});

describe("account isolation", () => {
  it("cancels a real Relay query and rejects late payloads after an account switch", async () => {
    const storage = new FakeStorage();
    let responseSink:
      | { next: (response: GraphQLResponse) => void; complete: () => void }
      | undefined;
    const cancelled = vi.fn();
    const previous = createRelayEnvironmentState({
      allowlist: {},
      authScope: "uid:user-a",
      cacheVersion: "1",
      now: Date.now,
      persistenceEnabled: true,
      storage,
      createNetwork: () =>
        Network.create(() =>
          Observable.create((sink) => {
            responseSink = sink;
            return cancelled;
          }),
        ),
    });
    const pending = fetchQuery(previous.environment, FeaturedEventsQueryNode, {
      campusSlug: "edison",
    }).toPromise();
    const rejected = expect(pending).rejects.toThrow(
      "Relay environment disposed",
    );
    const next = resolveRelayEnvironmentState({
      current: previous,
      isAuthReady: true,
      authScope: "uid:user-b",
      createEnvironment: (scope) => createPersistedState(scope, storage),
    });
    next?.source.set("client:root", {
      __id: "client:root",
      __typename: "__Root",
      marker: "B",
    });
    const before = storage
      .getAllKeys()
      .map((key) => [key, storage.getString(key)]);
    responseSink?.next({
      data: {
        featuredEvents: {
          __typename: "FeaturedEventsFetchError",
          message: "A",
        },
      },
    });
    responseSink?.complete();
    await rejected;
    expect(cancelled).toHaveBeenCalledOnce();
    expect(
      storage.getAllKeys().map((key) => [key, storage.getString(key)]),
    ).toEqual(before);
    expect(
      new MMKVRecordSource({
        authScope: "uid:user-b",
        cacheVersion: "1",
        storage,
      }).get("client:root"),
    ).toMatchObject({ marker: "B" });
    next?.dispose();
  });

  it.each(["query", "mutation"] as const)(
    "cancels %s requests and prevents new requests after disposal",
    (operationKind) => {
      const cancelled = vi.fn();
      const started = vi.fn(() =>
        Observable.create<GraphQLResponse>(() => cancelled),
      );
      const state = createRelayEnvironmentState({
        authScope: "anon",
        cacheVersion: "1",
        now: Date.now,
        persistenceEnabled: false,
        createNetwork: () => Network.create(started),
      });
      const operation = { ...FeaturedEventsQueryNode.params, operationKind };
      const onError = vi.fn();
      state.environment
        .getNetwork()
        .execute(operation, {}, {})
        .subscribe({ error: onError });
      state.dispose();
      state.dispose();
      state.environment
        .getNetwork()
        .execute(operation, {}, {})
        .subscribe({ error: onError });
      expect(cancelled).toHaveBeenCalledOnce();
      expect(started).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledTimes(2);
    },
  );

  it("revokes every old source mutation even after A returns and protects retention metadata", () => {
    const storage = new FakeStorage();
    let recordSuccess: (() => void) | undefined;
    const previous = createRelayEnvironmentState({
      authScope: "uid:user-a",
      cacheVersion: "1",
      now: Date.now,
      persistenceEnabled: true,
      storage,
      createNetwork: (onSuccess) => {
        recordSuccess = () => {
          onSuccess("FeaturedEventsQuery", { campusSlug: "edison" });
        };
        return createNetwork();
      },
    });
    previous.dispose();
    const next = createPersistedState("uid:user-b", storage);
    next.source.set("client:root", {
      __id: "client:root",
      __typename: "__Root",
      marker: "B",
    });
    storage.set("relay_retention_manifest", "current-manifest");
    const before = storage
      .getAllKeys()
      .map((key) => [key, storage.getString(key)]);
    previous.source.set("client:root", {
      __id: "client:root",
      __typename: "__Root",
      marker: "A",
    });
    previous.source.delete("client:root");
    previous.source.remove("client:root");
    previous.source.clear();
    recordSuccess?.();
    expect(
      storage.getAllKeys().map((key) => [key, storage.getString(key)]),
    ).toEqual(before);
    next.dispose();
    const returning = createPersistedState("uid:user-a", storage);
    returning.source.set("client:root", {
      __id: "client:root",
      __typename: "__Root",
      marker: "returning-A",
    });
    previous.source.clear();
    previous.source.set("client:root", {
      __id: "client:root",
      __typename: "__Root",
      marker: "old-A",
    });
    expect(
      new MMKVRecordSource({
        authScope: "uid:user-a",
        cacheVersion: "1",
        storage,
      }).get("client:root"),
    ).toMatchObject({ marker: "returning-A" });
    returning.dispose();
  });
});
