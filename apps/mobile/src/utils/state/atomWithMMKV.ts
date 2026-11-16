import { atomStorage } from "@/utils/mmkv";

export function getItem<T>(key: string): T | null {
  const value = atomStorage.getString(key);

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    atomStorage.remove(key);
    return null;
  }
}
