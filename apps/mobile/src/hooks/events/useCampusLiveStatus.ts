import { useConnectivityStatus } from "@/hooks/relay/useConnectivityAwareFetchPolicy";

import { useLiveStream } from "./useEventLive";

export function useCampusLiveStatus(slug: string): boolean | null {
  const { liveStream } = useLiveStream();
  const connectivity = useConnectivityStatus();
  return connectivity === "offline"
    ? null
    : (liveStream?.campusLiveStatus?.[slug] ?? null);
}
