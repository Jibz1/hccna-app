import { useEffect, useRef } from "react";
import type { View } from "react-native";

export function useCounterEntrance(onEnter: () => void) {
  const ref = useRef<View>(null);

  useEffect(() => {
    // React Native Web forwards View refs to their DOM element.
    const element = ref.current;
    if (!(element instanceof Element)) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some(
            (entry) => entry.isIntersecting && entry.intersectionRatio >= 1,
          )
        ) {
          observer.disconnect();
          onEnter();
        }
      },
      { threshold: 1 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [onEnter]);

  return { ref, onLayout: undefined };
}
