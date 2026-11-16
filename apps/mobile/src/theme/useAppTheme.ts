import { createContext, useContext } from "react";

import { darkTheme, lightTheme } from "./tokens";

export const AppThemeContext = createContext({ isDark: false });

/** The applied palette, independent of a pending appearance selection. */
export function useAppTheme() {
  const { isDark } = useContext(AppThemeContext);
  return isDark ? darkTheme : lightTheme;
}
