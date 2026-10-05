import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { ReactNode } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { COLORS } from "../lib/ui.ts";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export function Icon({
  name,
  size = 22,
  color = COLORS.text,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  return <MaterialCommunityIcons name={name as IconName} size={size} color={color} />;
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  icon?: string;
  disabled?: boolean;
  accessibilityHint?: string;
}

export function Button({
  label,
  onPress,
  variant = "secondary",
  icon,
  disabled,
  accessibilityHint,
}: ButtonProps) {
  const primary = variant === "primary";
  const danger = variant === "danger";
  const color = primary ? COLORS.primaryText : danger ? COLORS.danger : COLORS.text;
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
        primary && styles.buttonPrimary,
        danger && styles.buttonDanger,
        (pressed || disabled) && styles.pressed,
      ]}
    >
      {icon ? <Icon name={icon} size={20} color={color} /> : null}
      <Text style={[styles.buttonText, { color }]}>{label}</Text>
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
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={styles.headerButton}
        >
          <Icon name="arrow-left" />
        </Pressable>
      ) : (
        <View style={styles.headerButton} />
      )}
      <Text style={styles.headerTitle} accessibilityRole="header">
        {title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={styles.headerButton}
      >
        <Icon name="close" />
      </Pressable>
    </View>
  );
}

/** Warden never replaces 112; every reporting screen offers it. */
export function EmergencyCallButton() {
  const call = () =>
    Alert.alert("Call 112?", "112 is Nigeria's emergency number.", [
      { text: "Cancel", style: "cancel" },
      { text: "Call 112", style: "destructive", onPress: () => void Linking.openURL("tel:112") },
    ]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="In danger now? Call 112"
      onPress={call}
      style={styles.emergency}
    >
      <Icon name="phone" size={18} color={COLORS.primaryText} />
      <Text style={styles.emergencyText}>In danger now? Call 112</Text>
    </Pressable>
  );
}

export function Note({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warning";
}) {
  return (
    <View style={[styles.note, tone === "warning" && styles.noteWarning]}>
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  buttonPrimary: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  buttonDanger: { borderColor: COLORS.danger },
  buttonText: { fontSize: 16, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  headerButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  emergency: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: 16,
    backgroundColor: COLORS.danger,
  },
  emergencyText: { color: COLORS.primaryText, fontWeight: "700", fontSize: 15 },
  note: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#EEF4F2",
  },
  noteWarning: {
    backgroundColor: COLORS.warningBg,
    borderWidth: 1,
    borderColor: COLORS.warningBorder,
  },
  noteText: { color: COLORS.text, fontSize: 14, lineHeight: 20 },
});
