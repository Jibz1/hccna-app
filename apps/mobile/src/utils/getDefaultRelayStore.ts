import { getDefaultStore } from "jotai";

import { environmentAtom } from "@/environment";

const store = getDefaultStore();

export function getEnvironmentState() {
  return store.get(environmentAtom);
}

// Helper function to get environment safely
export function getEnvironment() {
  const environmentState = getEnvironmentState();
  if (!environmentState) {
    throw new Error("Relay environment not initialized");
  }
  return environmentState.environment;
}
