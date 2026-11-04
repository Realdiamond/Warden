// Text and text boxes in Warden's typeface and the current theme's colours. Use these instead of
// React Native's own, so a weight in a style picks the right font file and night mode applies.

import { forwardRef } from "react";
import {
  Text as NativeText,
  TextInput as NativeTextInput,
  StyleSheet,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from "react-native";
import { fontFor } from "../lib/theme.ts";
import { useTheme } from "./theme.tsx";

function withFont(style: TextProps["style"]): TextStyle {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  return {
    ...flat,
    fontFamily: fontFor(flat.fontWeight, flat.fontFamily),
    // Android falls back to the system font when a custom family is given a weight.
    fontWeight: "normal",
  };
}

export function Text({ style, ...props }: TextProps) {
  const c = useTheme();
  return <NativeText {...props} style={withFont([{ color: c.text }, style])} />;
}

export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function TextInput(
  { style, placeholderTextColor, ...props },
  ref,
) {
  const c = useTheme();
  return (
    <NativeTextInput
      ref={ref}
      placeholderTextColor={placeholderTextColor ?? c.muted}
      selectionColor={c.primary}
      {...props}
      style={withFont([{ color: c.text }, style])}
    />
  );
});
