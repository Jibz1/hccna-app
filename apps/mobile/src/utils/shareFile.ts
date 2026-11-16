import * as Sharing from "expo-sharing";

import { toast } from "@/ui/toast/Toast";

export async function shareFile(uri: string) {
  if (!(await Sharing.isAvailableAsync())) {
    toast.error({ title: "Sharing not available on this device" });
    return;
  }
  await Sharing.shareAsync(uri, {
    mimeType: "text/csv", // or 'application/json', 'text/html', etc.
    dialogTitle: "Save or send your export",
  });
}
