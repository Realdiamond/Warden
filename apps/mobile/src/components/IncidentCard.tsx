import { getCategory, type PublicIncident, publicLabelOf } from "@warden/shared";
import { StyleSheet, Text, View } from "react-native";
import { LABEL_EXPLANATION, SEVERITY_COLOR, timeAgo } from "../lib/format.ts";
import { COLORS } from "../lib/ui.ts";
import { Icon } from "./ui.tsx";

export function IncidentCard({ incident }: { incident: PublicIncident }) {
  const category = getCategory(incident.categoryId);
  const title = category ? publicLabelOf(category) : incident.categoryId;
  const color = SEVERITY_COLOR[incident.severity];
  return (
    <View style={styles.card} accessible accessibilityLabel={`${title}. ${incident.label}.`}>
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: `${color}22` }]}>
          <Icon name={category?.icon ?? "alert-circle"} color={color} />
        </View>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta}>
            {incident.active ? "Last report" : "Ended"} {timeAgo(incident.lastReportAt)} ·{" "}
            {incident.reportCount} report{incident.reportCount === 1 ? "" : "s"}
          </Text>
        </View>
      </View>
      <View style={styles.labelRow}>
        <Text style={[styles.label, incident.label === "Verified" && styles.labelVerified]}>
          {incident.label}
        </Text>
        <Text style={styles.explain}>{LABEL_EXPLANATION[incident.label]}</Text>
      </View>
      <Text style={styles.footnote}>
        Shown as an area, not an exact spot, to protect the people involved.
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
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: { flex: 1 },
  title: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  meta: { color: COLORS.muted, marginTop: 2 },
  labelRow: { gap: 2 },
  label: { fontWeight: "700", color: COLORS.text },
  labelVerified: { color: COLORS.primary },
  explain: { color: COLORS.muted },
  footnote: { fontSize: 12, color: COLORS.muted },
});
