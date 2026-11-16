import type { Environment, OperationDescriptor, Snapshot } from "relay-runtime";

type SnapshotEnvironment = Pick<Environment, "lookup" | "retain" | "subscribe">;

export function createRelayQuerySnapshotStore<TData>(
  environment: SnapshotEnvironment,
  operation: OperationDescriptor,
) {
  let snapshot = environment.lookup(operation.fragment);

  const getSnapshot = (): TData => snapshot.data as TData;

  const subscribe = (listener: () => void): (() => void) => {
    snapshot = environment.lookup(operation.fragment);
    const retained = environment.retain(operation);
    const disposable = environment.subscribe(
      snapshot,
      (nextSnapshot: Snapshot) => {
        snapshot = nextSnapshot;
        listener();
      },
    );

    return () => {
      disposable.dispose();
      retained.dispose();
    };
  };

  return {
    getSnapshot,
    subscribe,
  };
}
