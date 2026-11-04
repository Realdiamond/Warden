// Gives every screen the current palette, and builds each screen's styles once per palette.

import Constants from "expo-constants";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { LIGHT, MAP_STYLES, type Palette } from "../lib/theme.ts";

const extra = (Constants.expoConfig?.extra ?? {}) as {
  mapStyleUrl?: string;
  mapStyleDarkUrl?: string;
};

const ThemeContext = createContext<Palette>(LIGHT);

export function ThemeProvider({ palette, children }: { palette: Palette; children: ReactNode }) {
  return <ThemeContext.Provider value={palette}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Palette {
  return useContext(ThemeContext);
}

const cache = new WeakMap<object, Map<Palette, unknown>>();

/**
 * Styles that depend on the palette. Write `const makeStyles = (c: Palette) => StyleSheet.create
 * ({...})` beside the component and call `useStyles(makeStyles)` inside it; each palette's
 * styles are built only once.
 */
export function useStyles<T>(factory: (c: Palette) => T): T {
  const palette = useTheme();
  return useMemo(() => {
    let byPalette = cache.get(factory);
    if (!byPalette) {
      byPalette = new Map();
      cache.set(factory, byPalette);
    }
    if (!byPalette.has(palette)) byPalette.set(palette, factory(palette));
    return byPalette.get(palette) as T;
  }, [factory, palette]);
}

/** The map style for the current theme: calm grey by day, dark at night. */
export function useMapStyle(): string {
  const palette = useTheme();
  return palette.name === "dark"
    ? (extra.mapStyleDarkUrl ?? MAP_STYLES.dark)
    : (extra.mapStyleUrl ?? MAP_STYLES.light);
}
