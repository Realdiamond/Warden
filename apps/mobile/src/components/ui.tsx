import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { ReactNode } from "react";
import {
  Alert,
  Linking,
  Pressable,
  type StyleProp,
  StyleSheet,
  Switch,
  View,
  type ViewStyle,
} from "react-native";
import type { Palette } from "../lib/theme.ts";
import { MONO } from "../lib/theme.ts";
import { Text } from "./text.tsx";
import { useStyles, useTheme } from "./theme.tsx";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export function Icon({ name, size = 22, color }: { name: string; size?: number; color?: string }) {
  const c = useTheme();
  return <MaterialCommunityIcons name={name as IconName} size={size} color={color ?? c.text} />;
}

export type Tone =
  | "primary"
  | "neutral"
  | "danger"
  | "warning"
  | "advisory"
  | "responder"
  | "hazard";

/** Background and foreground for a soft, tinted tile. */
export function toneColors(c: Palette, tone: Tone): { bg: string; fg: string } {
  switch (tone) {
    case "primary":
      return { bg: c.primarySoft, fg: c.name === "dark" ? c.onPrimarySoft : c.primary };
    case "danger":
      return { bg: c.dangerSoft, fg: c.name === "dark" ? c.onDangerSoft : c.danger };
    case "warning":
      return { bg: c.warningSoft, fg: c.warningText };
    case "advisory":
      return { bg: c.advisorySoft, fg: c.advisoryText };
    case "responder":
      return { bg: c.responderSoft, fg: c.responderText };
    case "hazard":
      return { bg: c.hazardSoft, fg: c.name === "dark" ? c.warningText : c.hazard };
    default:
      return { bg: c.surfaceMuted, fg: c.text };
  }
}

export function IconTile({
  icon,
  tone = "primary",
  size = 40,
  round = false,
}: {
  icon: string;
  tone?: Tone;
  size?: number;
  round?: boolean;
}) {
  const c = useTheme();
  const { bg, fg } = toneColors(c, tone);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: round ? size / 2 : Math.round(size * 0.3),
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={icon} size={Math.round(size * 0.55)} color={fg} />
    </View>
  );
}

export type ButtonVariant = "primary" | "secondary" | "danger" | "dangerOutline" | "text";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: string;
  disabled?: boolean;
  accessibilityHint?: string;
  /** Large buttons end a screen ("Continue", "Start sharing"). */
  large?: boolean;
}

export function Button({
  label,
  onPress,
  variant = "secondary",
  icon,
  disabled,
  accessibilityHint,
  large,
}: ButtonProps) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const color =
    variant === "primary"
      ? c.onPrimary
      : variant === "danger"
        ? c.onDanger
        : variant === "dangerOutline"
          ? c.dangerText
          : variant === "text"
            ? c.primary
            : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        large && styles.buttonLarge,
        variant === "primary" && styles.buttonPrimary,
        variant === "danger" && styles.buttonDanger,
        variant === "dangerOutline" && styles.buttonDangerOutline,
        variant === "text" && styles.buttonText,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {icon ? <Icon name={icon} size={large ? 22 : 20} color={color} /> : null}
      <Text style={[styles.buttonLabel, large && styles.buttonLabelLarge, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function ModalHeader({
  title,
  onClose,
  onBack,
}: {
  title: string;
  onClose: () => void;
  onBack?: () => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={styles.headerBack}
        >
          <Icon name="chevron-left" size={28} />
        </Pressable>
      ) : null}
      <Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={2}>
        {title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={styles.headerClose}
      >
        <Icon name="close" />
      </Pressable>
    </View>
  );
}

/** Warden never replaces 112; every reporting screen offers it. */
export function EmergencyCallButton({
  tone = "solid",
  label = "In danger now? Call 112",
}: {
  tone?: "solid" | "soft";
  label?: string;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const call = () =>
    Alert.alert("Call 112?", "112 is Nigeria's emergency number.", [
      { text: "Cancel", style: "cancel" },
      { text: "Call 112", style: "destructive", onPress: () => void Linking.openURL("tel:112") },
    ]);
  const soft = tone === "soft";
  const color = soft ? c.onDangerSoft : c.onDanger;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={call}
      style={({ pressed }) => [
        styles.emergency,
        soft && styles.emergencySoft,
        pressed && styles.pressed,
      ]}
    >
      <Icon name="phone" size={20} color={color} />
      <Text style={[styles.emergencyText, soft && styles.emergencyTextSoft, { color }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Note({
  children,
  tone = "info",
  icon,
}: {
  children: ReactNode;
  tone?: "info" | "warning";
  icon?: string;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const warning = tone === "warning";
  const glyph = icon ?? (warning ? "alert-circle-outline" : "information-outline");
  return (
    <View style={[styles.note, warning && styles.noteWarning]}>
      <Icon name={glyph} size={20} color={warning ? c.warningText : c.primary} />
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles(makeStyles);
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Divider({ inset = 16 }: { inset?: number }) {
  const styles = useStyles(makeStyles);
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <Text style={styles.sectionLabel} accessibilityRole="header">
      {children}
    </Text>
  );
}

/** A tappable row: icon tile, title, one-line description, then a badge or chevron. */
export function ListRow({
  icon,
  tone = "primary",
  title,
  description,
  onPress,
  badge,
  right,
  accessibilityLabel,
}: {
  icon?: string;
  tone?: Tone;
  title: string;
  description?: string;
  onPress?: () => void;
  badge?: string;
  right?: ReactNode;
  accessibilityLabel?: string;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const body = (
    <>
      {icon ? <IconTile icon={icon} tone={tone} size={40} /> : null}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {description ? <Text style={styles.rowDescription}>{description}</Text> : null}
      </View>
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
      {right}
      {onPress && !right ? <Icon name="chevron-right" size={22} color={c.faint} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? [title, description, badge].filter(Boolean).join(". ")
      }
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {body}
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: string;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      {icon ? <Icon name={icon} size={18} color={selected ? c.onPrimary : c.text} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: { value: T; label: string; accessibilityLabel?: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.segmented} accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SwitchRow({
  title,
  description,
  value,
  onValueChange,
  disabled,
}: {
  title: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.switchRow}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {description ? <Text style={styles.rowDescription}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={title}
        trackColor={{ false: c.borderStrong, true: c.primary }}
        thumbColor={c.name === "dark" && value ? c.onPrimary : c.surface}
      />
    </View>
  );
}

/** "2 of 5" progress for the first-run setup. */
export function Steps({ current, total }: { current: number; total: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View
      style={styles.steps}
      accessible
      accessibilityLabel={`Step ${current} of ${total}`}
      accessibilityRole="progressbar"
    >
      <View style={styles.stepBars}>
        {Array.from({ length: total }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed, ordered bars
          <View key={i} style={[styles.stepBar, i < current && styles.stepBarDone]} />
        ))}
      </View>
      <Text style={styles.stepText}>
        {current} of {total}
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    button: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingHorizontal: 18,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.borderStrong,
      backgroundColor: c.surface,
    },
    buttonLarge: { minHeight: 58 },
    buttonPrimary: { backgroundColor: c.primary, borderColor: c.primary },
    buttonDanger: { backgroundColor: c.danger, borderColor: c.danger },
    buttonDangerOutline: { borderColor: c.dangerText, backgroundColor: "transparent" },
    buttonText: { borderColor: "transparent", backgroundColor: "transparent", minHeight: 44 },
    buttonLabel: { fontSize: 16, fontWeight: "700", textAlign: "center", flexShrink: 1 },
    buttonLabelLarge: { fontSize: 18 },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.75 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingLeft: 16,
      paddingRight: 12,
      paddingTop: 12,
      paddingBottom: 8,
      backgroundColor: c.background,
    },
    headerBack: {
      width: 44,
      height: 44,
      marginLeft: -10,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: { flex: 1, fontSize: 24, fontWeight: "800", color: c.text },
    headerClose: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    emergency: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      minHeight: 52,
      borderRadius: 16,
      paddingHorizontal: 16,
      backgroundColor: c.danger,
    },
    emergencySoft: {
      justifyContent: "flex-start",
      minHeight: 48,
      borderRadius: 14,
      backgroundColor: c.dangerSoft,
    },
    emergencyText: { fontWeight: "700", fontSize: 16 },
    emergencyTextSoft: { fontSize: 15, flexShrink: 1 },
    note: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      padding: 14,
      borderRadius: 14,
      backgroundColor: c.surfaceMuted,
    },
    noteWarning: {
      backgroundColor: c.noteWarningBg,
      borderWidth: 1,
      borderColor: c.noteWarningBorder,
    },
    noteText: { flex: 1, color: c.text, fontSize: 15, lineHeight: 21 },
    card: {
      backgroundColor: c.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.border,
      overflow: "hidden",
    },
    divider: { height: 1, backgroundColor: c.divider, marginRight: 16 },
    sectionLabel: {
      fontSize: 12,
      fontWeight: "700",
      letterSpacing: 1,
      textTransform: "uppercase",
      color: c.muted,
      paddingHorizontal: 6,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 60,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    rowPressed: { backgroundColor: c.surfaceMuted },
    rowText: { flex: 1, gap: 2 },
    rowTitle: { fontSize: 16, fontWeight: "700", color: c.text },
    rowDescription: { fontSize: 14, lineHeight: 19, color: c.muted },
    badge: {
      minWidth: 24,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 12,
      overflow: "hidden",
      backgroundColor: c.danger,
      color: c.onDanger,
      fontSize: 13,
      fontWeight: "700",
      fontFamily: MONO,
      textAlign: "center",
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 40,
      paddingHorizontal: 14,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.borderStrong,
      backgroundColor: c.surface,
    },
    chipSelected: { backgroundColor: c.primary, borderColor: c.primary },
    chipText: { fontSize: 15, fontWeight: "600", color: c.text },
    chipTextSelected: { color: c.onPrimary },
    segmented: {
      flexDirection: "row",
      padding: 4,
      gap: 2,
      borderRadius: 22,
      backgroundColor: c.surface,
      shadowColor: c.shadow,
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    segment: {
      minHeight: 36,
      paddingHorizontal: 12,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    segmentSelected: { backgroundColor: c.primary },
    segmentText: { fontSize: 14, fontWeight: "700", color: c.text },
    segmentTextSelected: { color: c.onPrimary },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 60,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    steps: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
    stepBars: { flex: 1, flexDirection: "row", gap: 6 },
    stepBar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: c.border },
    stepBarDone: { backgroundColor: c.primary },
    stepText: { fontSize: 13, fontFamily: MONO, color: c.muted, minWidth: 40, textAlign: "right" },
  });
