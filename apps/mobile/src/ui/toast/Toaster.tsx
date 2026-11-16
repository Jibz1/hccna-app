import { Toaster as SonnerToast } from "sonner-native";

import { spacing } from "@/theme/tokens";

export function Toaster() {
  return (
    <SonnerToast position="top-center" offset={spacing.l} visibleToasts={2} />
  );
}
