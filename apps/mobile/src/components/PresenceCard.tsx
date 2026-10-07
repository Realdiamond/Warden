import type { DeploymentKind, PublicPresence } from "@warden/shared";
import { StyleSheet, Text, View } from "react-native";
import { COLORS } from "../lib/ui.ts";
import { PRESENCE_COLOR } from "./IncidentMap.tsx";
import { Icon } from "./ui.tsx";

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
  const kind = KIND[presence.kind];
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`${kind.label} by ${presence.organisation}, until ${clock(presence.until)}`}
    >
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Icon name={kind.icon} color={PRESENCE_COLOR} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.title}>
            {kind.label}: {presence.label}
          </Text>
          <Text style={styles.meta}>
            {presence.organisation} · until {clock(presence.until)}
          </Text>
        </View>
      </View>
      <Text style={styles.footnote}>
        Shown as an area. Responders choose what to share; not every team appears here.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    elevation: 6,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: `${PRESENCE_COLOR}22`,
  },
  flex: { flex: 1 },
  title: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  meta: { color: COLORS.muted, marginTop: 2 },
  footnote: { fontSize: 12, color: COLORS.muted },
});
