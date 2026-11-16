/** Canonical native and Tailwind palette. Run `bun run theme:generate` after editing. */
export const spacing = {
  px: 1,
  none: 0,
  "6xs": 4,
  "5xs": 8,
  "4xs": 12,
  "3xs": 16,
  "2xs": 20,
  xs: 24,
  s: 32,
  m: 40,
  l: 48,
  xl: 56,
  "2xl": 64,
  "3xl": 80,
  "4xl": 96,
  "5xl": 120,
} as const;

export type ThemeColors = {
  background: string;
  text: string;
  textMuted: string;
  accent: string;
  surface: string;
  surfaceStrong: string;
  border: string;
  inputBorder: string;
  overlay: string;
  onImage: string;
  selected: string;
  chrome: string;
  shadow: string;
  negative: string;
  photoOverlay: string;
  modalChrome: string;
};

export type ScreenTheme = {
  isDark: boolean;
  colors: ThemeColors;
  surfaces: { card: string; muted: string };
  backgroundGradient: readonly [string, string, ...string[]];
  backgroundGradientLocations: readonly [number, number, ...number[]];
};

const lightColors: ThemeColors = {
  background: "#ffffff",
  text: "#342b27",
  textMuted: "#756358",
  accent: "#995234",
  surface: "rgba(255, 251, 245, 0.78)",
  surfaceStrong: "#fffcf7",
  border: "rgba(139, 100, 76, 0.13)",
  inputBorder: "rgba(139, 100, 76, 0.28)",
  overlay: "rgba(35, 25, 20, 0.65)",
  onImage: "#fffdf8",
  selected: "#f5e5d8",
  chrome: "rgba(255, 251, 245, 0.9)",
  shadow: "rgba(98, 62, 38, 0.1)",
  negative: "#a33a32",
  photoOverlay: "rgba(57, 42, 33, 0.25)",
  modalChrome: "rgba(253, 252, 255, 0.9)",
};

export const lightTheme: ScreenTheme = {
  isDark: false,
  colors: lightColors,
  surfaces: { card: "#fdfcff", muted: "#faf1ed" },
  backgroundGradient: [
    lightColors.background,
    lightColors.background,
    "#ffe6dd",
    "#fff0cc",
    "#eee9e1",
  ],
  backgroundGradientLocations: [0, 0.18, 0.44, 0.78, 1],
};

const darkColors: ThemeColors = {
  background: "#211c19",
  text: "#fff4e7",
  textMuted: "#c8b6a7",
  accent: "#f1b58f",
  surface: "rgba(66, 51, 43, 0.8)",
  surfaceStrong: "#3a2e28",
  border: "rgba(255, 221, 188, 0.13)",
  inputBorder: "rgba(255, 221, 188, 0.28)",
  overlay: "rgba(17, 12, 9, 0.72)",
  onImage: "#fffdf8",
  selected: "#574033",
  chrome: "rgba(46, 36, 30, 0.94)",
  shadow: "rgba(0, 0, 0, 0.24)",
  negative: "#ffb4ab",
  photoOverlay: "rgba(13, 10, 8, 0.56)",
  modalChrome: "rgba(46, 36, 30, 0.94)",
};

export const darkTheme: ScreenTheme = {
  isDark: true,
  colors: darkColors,
  surfaces: { card: darkColors.surfaceStrong, muted: "#49382f" },
  backgroundGradient: [darkColors.background, "#34241f", "#3c3020"],
  backgroundGradientLocations: [0, 0.5, 1],
};
