import type { DynamicTheme } from "@/utils/devicePrefsSchema";

/** Persisted names predate the current palette; keep existing selections valid. */
export function mapDynamicThemeToUniwind(theme: DynamicTheme) {
  switch (theme) {
    case "purple-light":
      return "light";
    case "purple-dark":
      return "dark";
    case "auto":
      return "system";
  }
}
