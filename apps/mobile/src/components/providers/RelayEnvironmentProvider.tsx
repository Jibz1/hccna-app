import { useAtomValue } from "jotai";
import { ReactNode } from "react";
import { RelayEnvironmentProvider as BaseRelayEnvironmentProvider } from "react-relay";

import { useSavedVersesImport } from "@/components/saved-verses/useSavedVersesImport";
import { environmentAtom } from "@/environment";
import { useProfileEnrichmentRefresh } from "@/hooks/relay/useProfileEnrichmentRefresh";

function ProfileEnrichmentRefresh() {
  useProfileEnrichmentRefresh();
  return null;
}

function SavedVersesImport() {
  useSavedVersesImport();
  return null;
}

export function RelayEnvironmentProvider({
  children,
}: {
  children: ReactNode;
}) {
  const environmentState = useAtomValue(environmentAtom);

  if (environmentState === null) {
    return null;
  }

  return (
    <BaseRelayEnvironmentProvider environment={environmentState.environment}>
      <ProfileEnrichmentRefresh />
      <SavedVersesImport />
      {children}
    </BaseRelayEnvironmentProvider>
  );
}
