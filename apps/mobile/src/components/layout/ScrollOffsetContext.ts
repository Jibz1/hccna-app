import { createContext } from "react";
import type { SharedValue } from "react-native-reanimated";

export const ScrollOffsetContext = createContext<SharedValue<number> | null>(
  null,
);
