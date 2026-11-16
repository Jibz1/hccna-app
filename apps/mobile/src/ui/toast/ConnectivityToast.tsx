import { useEffect, useRef } from "react";

import { useConnectivityStatus } from "@/hooks/relay/useConnectivityAwareFetchPolicy";
import { toast } from "@/ui/toast/Toast";

const CONNECTIVITY_TOAST_ID = "connectivity-status";

export function ConnectivityToast() {
  const status = useConnectivityStatus();
  const wasOffline = useRef(false);

  useEffect(() => {
    if (status === "offline") {
      wasOffline.current = true;
      toast.offline({
        id: CONNECTIVITY_TOAST_ID,
        title: "Offline mode",
        message: "Showing saved content. We'll reconnect automatically.",
        options: { duration: 5000, position: "bottom-center" },
      });
      return;
    }

    if (status === "online" && wasOffline.current) {
      wasOffline.current = false;
      toast.online({
        id: CONNECTIVITY_TOAST_ID,
        title: "Back online",
        message: "Your connection has been restored.",
        options: { duration: 5000, position: "bottom-center" },
      });
    }
  }, [status]);

  return null;
}
