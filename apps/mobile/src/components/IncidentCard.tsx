import {
  getCategory,
  type PublicIncident,
  publicLabelOf,
  REACTION_KINDS,
  type ReactionKind,
} from "@warden/shared";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LABEL_EXPLANATION, SEVERITY_COLOR, timeAgo } from "../lib/format.ts";
import { REACTION_TEXT } from "../lib/reactions.ts";
import { COLORS } from "../lib/ui.ts";
import { Icon } from "./ui.tsx";

const REACTION_ICON: Record<ReactionKind, string> = {
  confirm: "alert",
  over: "check-circle-outline",
  false: "close-circle-outline",
};

export function IncidentCard({
  incident,
  reacted,
  onReact,
}: {
  incident: PublicIncident;
  /** This phone's earlier reaction, if any. */
  reacted: ReactionKind | null;
  /** Resolves to a message to show. */
  onReact: (kind: ReactionKind) => Promise<string>;
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
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
      {incident.active &&
        (reacted ? (
          <Text style={styles.reacted}>
            You said: {REACTION_TEXT[reacted]}. {feedback ?? "Thank you."}
          </Text>
        ) : (
          <View style={styles.reactions}>
            <Text style={styles.ask}>Are you nearby?</Text>
            <View style={styles.reactionRow}>
              {REACTION_KINDS.map((kind) => (
                <Pressable
                  key={kind}
                  accessibilityRole="button"
                  accessibilityLabel={REACTION_TEXT[kind]}
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => {
                    setBusy(true);
                    void onReact(kind)
                      .then(setFeedback)
                      .finally(() => setBusy(false));
                  }}
                  style={({ pressed }) => [styles.reaction, (pressed || busy) && styles.pressed]}
                >
                  <Icon name={REACTION_ICON[kind]} size={18} color={COLORS.primary} />
                  <Text style={styles.reactionText}>{REACTION_TEXT[kind]}</Text>
                </Pressable>
              ))}
            </View>
            {feedback && <Text style={styles.reacted}>{feedback}</Text>}
          </View>
        ))}
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
  reactions: { gap: 6 },
  ask: { fontWeight: "600", color: COLORS.text },
  reactionRow: { flexDirection: "row", gap: 6 },
  reaction: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 4,
  },
  reactionText: { color: COLORS.text, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  pressed: { opacity: 0.6 },
  reacted: { color: COLORS.primary, fontWeight: "600" },
});
