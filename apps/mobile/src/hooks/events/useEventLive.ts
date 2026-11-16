import {
  doc,
  getDoc,
  onSnapshot,
  getFirestore,
} from "@react-native-firebase/firestore";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

import { captureException } from "@/utils/sentry";

type LiveStream = {
  campusLiveStatus?: Record<string, boolean | null>;
  isLive: boolean;
  streamUrl?: string;
  streamTitle?: string;
  streamDescription?: string;
  streamImage?: string;
  streams?: {
    id: string;
    isLive: boolean;
    slug: string;
  }[];
};

let liveStreamSnapshot: LiveStream | null = null;
let unsubscribeLiveStream: (() => void) | null = null;
const listeners = new Set<() => void>();
const WEB_POLL_INTERVAL_MS = 60_000;

function emitChange() {
  listeners.forEach((listener) => {
    listener();
  });
}

function reportLiveStreamError(cause: unknown) {
  console.error("Error loading live stream config:", cause);
  captureException(cause);
  liveStreamSnapshot = null;
  emitChange();
}

function pollWebLiveStream(docRef: ReturnType<typeof doc>) {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reportedError = false;

  async function poll() {
    try {
      // React Native Firebase uses Firestore Lite on web, where onSnapshot
      // is unsupported. Fetch the same live document without a listener.
      const snapshot = await getDoc(docRef);
      if (!active) {
        return;
      }
      const data = snapshot.exists() ? snapshot.data() : undefined;
      liveStreamSnapshot = data ? (data as LiveStream) : null;
      reportedError = false;
      emitChange();
    } catch (error) {
      if (active && !reportedError) {
        reportedError = true;
        reportLiveStreamError(error);
      }
    } finally {
      if (active) {
        // Schedule after completion so slow requests never overlap.
        timer = setTimeout(() => {
          void poll();
        }, WEB_POLL_INTERVAL_MS);
      }
    }
  }

  void poll();
  return () => {
    active = false;
    clearTimeout(timer);
  };
}

function startLiveStreamSubscription() {
  if (unsubscribeLiveStream) {
    return;
  }

  try {
    const docRef = doc(getFirestore(), "app-config", "live-stream");
    unsubscribeLiveStream =
      Platform.OS === "web"
        ? pollWebLiveStream(docRef)
        : onSnapshot(
            docRef,
            (snapshot) => {
              const data = snapshot.exists() ? snapshot.data() : undefined;
              liveStreamSnapshot = data ? (data as LiveStream) : null;
              emitChange();
            },
            reportLiveStreamError,
          );
  } catch (error) {
    // A missing platform capability must not prevent Home from rendering.
    reportLiveStreamError(error);
  }
}

function stopLiveStreamSubscriptionIfIdle() {
  if (listeners.size > 0 || !unsubscribeLiveStream) {
    return;
  }

  unsubscribeLiveStream();
  unsubscribeLiveStream = null;
  liveStreamSnapshot = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  startLiveStreamSubscription();

  return () => {
    listeners.delete(listener);
    stopLiveStreamSubscriptionIfIdle();
  };
}

function getSnapshot() {
  return liveStreamSnapshot;
}

export function useLiveStream() {
  const liveStream = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { liveStream };
}
