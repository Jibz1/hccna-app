import { useEffect, useEffectEvent, useRef } from "react";

export function getEventCheckInDefaultsKey({
  attendeeIds,
  notes,
  topic,
}: {
  attendeeIds: readonly string[];
  notes: string;
  topic: string;
}) {
  return JSON.stringify([attendeeIds, notes, topic]);
}

export function usePristineCheckInDefaultsSync({
  defaultsKey,
  isDirty,
  sync,
}: {
  defaultsKey: string;
  isDirty: boolean;
  sync: () => void;
}) {
  const lastSyncedDefaultsKeyRef = useRef<string | null>(null);
  const syncDefaults = useEffectEvent(sync);

  useEffect(() => {
    // Relay values can be normalized into new arrays every render. Sync each
    // semantic payload once so the state write cannot feed back into itself.
    if (isDirty || lastSyncedDefaultsKeyRef.current === defaultsKey) {
      return;
    }

    lastSyncedDefaultsKeyRef.current = defaultsKey;
    syncDefaults();
  }, [defaultsKey, isDirty]);
}
