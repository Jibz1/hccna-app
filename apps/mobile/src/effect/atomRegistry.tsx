import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import type { ReactNode } from "react";

const appAtomRegistry = AtomRegistry.make();

export function AppAtomRegistryProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      {children}
    </RegistryContext.Provider>
  );
}
