// Warden's look (M10): colours for day and night, font names, and the night mode choice.
//
// Green means safe and trusted; red is kept for danger (SOS, 112, emergencies). Severity colours
// on the map also differ in lightness and always come with an icon, so they can be told apart
// without colour. The night palette keeps the screen dim so it does not light up a face in the
// dark during a trip or an SOS.

export type ThemeName = "light" | "dark";
/** What the person chose in Settings. "system" follows the phone's dark mode. */
export type ThemeSetting = "system" | "light" | "dark";
export const THEME_SETTINGS: readonly ThemeSetting[] = ["system", "light", "dark"];

export interface Palette {
  name: ThemeName;
  background: string;
  surface: string;
  /** Quiet fills: icon tiles, pressed rows, segmented controls. */
  surfaceMuted: string;
  text: string;
  muted: string;
  /** Decoration only (chevrons, handles), never words. */
  faint: string;
  border: string;
  borderStrong: string;
  divider: string;
  primary: string;
  onPrimary: string;
  primarySoft: string;
  onPrimarySoft: string;
  /** Fill for SOS and 112 buttons. */
  danger: string;
  onDanger: string;
  /** Red words on the page background. */
  dangerText: string;
  dangerSoft: string;
  onDangerSoft: string;
  /** Severity colours: markers and tiles. */
  critical: string;
  warning: string;
  warningText: string;
  warningSoft: string;
  advisory: string;
  advisoryText: string;
  advisorySoft: string;
  responder: string;
  responderText: string;
  responderSoft: string;
  hazard: string;
  hazardSoft: string;
  /** The person's own position on maps. */
  user: string;
  /** Notes that need attention (demo mode, cautions). */
  noteWarningBg: string;
  noteWarningBorder: string;
  /** Map overlays sit on this; also the colour of drop shadows. */
  shadow: string;
  statusBar: "dark" | "light";
}

export const LIGHT: Palette = {
  name: "light",
  background: "#F3F5F4",
  surface: "#FFFFFF",
  surfaceMuted: "#EEF2F1",
  text: "#13201B",
  muted: "#4A5852",
  faint: "#7A8782",
  border: "#D6DDDA",
  borderStrong: "#C3CCC8",
  divider: "#E4E9E7",
  primary: "#0F5C4D",
  onPrimary: "#FFFFFF",
  primarySoft: "#E1EFEA",
  onPrimarySoft: "#0B4A3E",
  danger: "#B42318",
  onDanger: "#FFFFFF",
  dangerText: "#B42318",
  dangerSoft: "#FDECEA",
  onDangerSoft: "#8F1B12",
  critical: "#B42318",
  warning: "#B45309",
  warningText: "#9A4508",
  warningSoft: "#FBEBDC",
  advisory: "#1D4ED8",
  advisoryText: "#1D4ED8",
  advisorySoft: "#E3EAFD",
  responder: "#5B21B6",
  responderText: "#3B1585",
  responderSoft: "#F1EBFB",
  hazard: "#9A3412",
  hazardSoft: "#FCE7DA",
  user: "#2563EB",
  noteWarningBg: "#FFF8E6",
  noteWarningBorder: "#E9C46A",
  shadow: "#13201B",
  statusBar: "dark",
};

export const DARK: Palette = {
  name: "dark",
  background: "#0B1210",
  surface: "#15201C",
  surfaceMuted: "#1C2925",
  text: "#E7EEEB",
  muted: "#A3B2AC",
  faint: "#7E8E88",
  border: "#2A3833",
  borderStrong: "#3A4A44",
  divider: "#22302B",
  primary: "#5CC9A7",
  onPrimary: "#0B1210",
  primarySoft: "#1F3A33",
  onPrimarySoft: "#8FE0C6",
  danger: "#D33A2C",
  onDanger: "#FFFFFF",
  dangerText: "#FF8A7F",
  dangerSoft: "#3A1714",
  onDangerSoft: "#FFB3AA",
  critical: "#E5483A",
  warning: "#D9822B",
  warningText: "#F0A35E",
  warningSoft: "#3A2614",
  advisory: "#3B5BDB",
  advisoryText: "#9DB2FF",
  advisorySoft: "#1B2440",
  responder: "#8B5CF6",
  responderText: "#C4B0F5",
  responderSoft: "#2A2145",
  hazard: "#C2410C",
  hazardSoft: "#3A2014",
  user: "#4C8DFF",
  noteWarningBg: "#2A2414",
  noteWarningBorder: "#7A6526",
  shadow: "#000000",
  statusBar: "light",
};

/** The palette to use, given the person's choice and the phone's own dark mode setting. */
export function resolveTheme(
  setting: ThemeSetting | undefined,
  /** The phone's setting as React Native reports it ("light", "dark", or not known). */
  system: string | null | undefined,
): Palette {
  if (setting === "dark") return DARK;
  if (setting === "light") return LIGHT;
  return system === "dark" ? DARK : LIGHT;
}

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return typeof value === "string" && (THEME_SETTINGS as readonly string[]).includes(value);
}

/**
 * Atkinson Hyperlegible, designed to be easy to read for people with low vision; it helps on
 * cheap screens in bright sun. Each weight is its own file (Android does not pick weights of a
 * custom font by itself), bundled by the expo-font plugin in app.config.ts.
 */
export const FONTS = {
  regular: "AtkinsonHyperlegibleNext_400Regular",
  medium: "AtkinsonHyperlegibleNext_500Medium",
  bold: "AtkinsonHyperlegibleNext_700Bold",
  extraBold: "AtkinsonHyperlegibleNext_800ExtraBold",
  mono: "AtkinsonHyperlegibleMono_500Medium",
  monoBold: "AtkinsonHyperlegibleMono_700Bold",
} as const;

/** Set `fontFamily: MONO` in a style to get the mono face; the weight picks the file. */
export const MONO = "mono";

/** The font file for a style's weight. */
export function fontFor(weight: string | number | undefined, family: string | undefined): string {
  const w = typeof weight === "number" ? weight : weight === "bold" ? 700 : Number(weight ?? 400);
  const heavy = Number.isFinite(w) ? w : 400;
  if (family === MONO) return heavy >= 600 ? FONTS.monoBold : FONTS.mono;
  if (heavy >= 800) return FONTS.extraBold;
  if (heavy >= 600) return FONTS.bold;
  if (heavy >= 500) return FONTS.medium;
  return FONTS.regular;
}

/** OpenFreeMap styles: a calm grey map by day so incident colours stand out, a dark one at night. */
export const MAP_STYLES: Record<ThemeName, string> = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
