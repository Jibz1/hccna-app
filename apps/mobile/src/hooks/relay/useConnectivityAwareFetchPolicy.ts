import { useSyncExternalStore } from "react";

import { connectivity, type ConnectivityStatus } from "@/effect/connectivity";

export type ConnectivityAwareFetchPolicy = "store-and-network" | "store-only";

export function getConnectivityAwareFetchPolicy(
  status: ConnectivityStatus,
): ConnectivityAwareFetchPolicy {
  return status === "offline" ? "store-only" : "store-and-network";
}

export function useConnectivityStatus(): ConnectivityStatus {
  return useSyncExternalStore(
    connectivity.subscribe,
    connectivity.getSnapshot,
    connectivity.getServerSnapshot,
  );
}

export function useConnectivityAwareFetchPolicy(): ConnectivityAwareFetchPolicy {
  return getConnectivityAwareFetchPolicy(useConnectivityStatus());
}
