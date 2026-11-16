import * as Clipboard from "expo-clipboard";

export function useClipboard() {
  const copy = async (text: string) => await Clipboard.setStringAsync(text);

  const fetch = () => Clipboard.getStringAsync();

  return { copy, fetch };
}
