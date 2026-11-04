import type { DeploymentKind, PublicPresence } from "@warden/shared";
import { StyleSheet, View } from "react-native";
import { MONO, type Palette } from "../lib/theme.ts";
import { Text } from "./text.tsx";
import { useStyles } from "./theme.tsx";
import { IconTile } from "./ui.tsx";

const KIND: Record<DeploymentKind, { label: string; icon: string }> = {
  patrol: { label: "Patrol", icon: "police-badge" },
  checkpoint: { label: "Checkpoint", icon: "boom-gate" },
  ambulance: { label: "Ambulance", icon: "ambulance" },
  fire_unit: { label: "Fire service", icon: "fire-truck" },
  rescue: { label: "Rescue team", icon: "lifebuoy" },
  other: { label: "Responders", icon: "shield-account" },
};

function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** A responder deployment the organisation chose to show the public. */
export function PresenceCard({ presence }: { presence: PublicPresence }) {
  const styles = useStyles(makeStyles);
  const kind = KIND[presence.kind];
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`${kind.label} by ${presence.organisation}, until ${clock(presence.until)}`}
    >
      <View style={styles.row}>
        <IconTile icon={kind.icon} tone="responder" size={48} />
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>Responders</Text>
          <Text style={styles.title}>
            {kind.label}: {presence.label}
          </Text>
          <Text style={styles.meta}>
            {presence.organisation} · until <Text style={styles.time}>{clock(presence.until)}</Text>
          </Text>
        </View>
      </View>
      <Text style={styles.footnote}>
        Shown as an area. Responders choose what to share; not every team appears here.
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: 22,
      padding: 16,
      gap: 12,
      borderWidth: c.name === "dark" ? 1 : 0,
      borderColor: c.border,
      shadowColor: c.shadow,
      shadowOpacity: 0.16,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    row: { flexDirection: "row", alignItems: "center", gap: 14 },
    flex: { flex: 1, gap: 2 },
    eyebrow: {
      fontSize: 12,
      fontWeight: "700",
      letterSpacing: 1,
      textTransform: "uppercase",
      color: c.name === "dark" ? c.responderText : c.responder,
    },
    title: { fontSize: 19, fontWeight: "800", color: c.text },
    meta: { color: c.muted, fontSize: 14 },
    time: { fontFamily: MONO, color: c.muted },
    footnote: { fontSize: 13.5, lineHeight: 19, color: c.muted },
  });
