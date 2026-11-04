import { describe, expect, it } from "vitest";
import {
  DARK,
  FONTS,
  fontFor,
  isThemeSetting,
  LIGHT,
  MONO,
  type Palette,
  resolveTheme,
} from "./theme.ts";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text colour on the background it is used on. Every pair must reach 4.5:1 (WCAG AA). */
function textPairs(c: Palette): [string, string, string][] {
  return [
    ["text on background", c.text, c.background],
    ["text on surface", c.text, c.surface],
    ["muted on background", c.muted, c.background],
    ["muted on surface", c.muted, c.surface],
    ["muted on muted surface", c.muted, c.surfaceMuted],
    ["on primary", c.onPrimary, c.primary],
    ["primary words on surface", c.primary, c.surface],
    ["on primary soft", c.onPrimarySoft, c.primarySoft],
    ["on danger", c.onDanger, c.danger],
    ["danger words on background", c.dangerText, c.background],
    ["danger words on surface", c.dangerText, c.surface],
    ["on danger soft", c.onDangerSoft, c.dangerSoft],
    ["warning words on surface", c.warningText, c.surface],
    ["advisory words on surface", c.advisoryText, c.surface],
    ["responder words on responder soft", c.responderText, c.responderSoft],
    ["text on warning note", c.text, c.noteWarningBg],
  ];
}

describe("palettes", () => {
  for (const palette of [LIGHT, DARK]) {
    for (const [name, fg, bg] of textPairs(palette)) {
      it(`${palette.name}: ${name} is readable`, () => {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("follows the phone unless the person chose", () => {
    expect(resolveTheme("system", "dark")).toBe(DARK);
    expect(resolveTheme("system", "light")).toBe(LIGHT);
    expect(resolveTheme(undefined, null)).toBe(LIGHT);
    expect(resolveTheme("dark", "light")).toBe(DARK);
    expect(resolveTheme("light", "dark")).toBe(LIGHT);
    expect(isThemeSetting("dark")).toBe(true);
    expect(isThemeSetting("blue")).toBe(false);
  });
});

describe("fonts", () => {
  it("picks the file for each weight", () => {
    expect(fontFor(undefined, undefined)).toBe(FONTS.regular);
    expect(fontFor("500", undefined)).toBe(FONTS.medium);
    expect(fontFor("600", undefined)).toBe(FONTS.bold);
    expect(fontFor("bold", undefined)).toBe(FONTS.bold);
    expect(fontFor("800", undefined)).toBe(FONTS.extraBold);
    expect(fontFor(900, undefined)).toBe(FONTS.extraBold);
    expect(fontFor("700", MONO)).toBe(FONTS.monoBold);
    expect(fontFor(undefined, MONO)).toBe(FONTS.mono);
  });
});
