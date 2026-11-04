import {
  distanceMeters,
  getCategory,
  type PublicIncident,
  type PublicLabel,
  publicLabelOf,
  REACTION_KINDS,
  type ReactionKind,
} from "@warden/shared";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { LABEL_EXPLANATION, timeAgo } from "../lib/format.ts";
import { categoryName, type Language, strings } from "../lib/i18n.ts";
import type { Position } from "../lib/location.ts";
import { REACTION_TEXT } from "../lib/reactions.ts";
import type { Palette } from "../lib/theme.ts";
import { Text } from "./text.tsx";
import { useStyles, useTheme } from "./theme.tsx";
import { Icon, IconTile, type Tone } from "./ui.tsx";

const REACTION_ICON: Record<ReactionKind, string> = {
  confirm: "alert-outline",
  over: "check-circle-outline",
  false: "close-circle-outline",
};

/** How sure Warden is, as steps: one report, several reports, checked by Warden or a responder. */
const CONFIDENCE_STEP: Partial<Record<PublicLabel, number>> = {
  Unconfirmed: 1,
  Corroborated: 2,
  Verified: 3,
};
const STEP_NAMES = ["Reported", "Corroborated", "Verified"];

function distanceText(from: Position | null, incident: PublicIncident): string | null {
  if (!from) return null;
  const m = distanceMeters(from, incident.center);
  if (m < 1_000) return `${Math.max(100, Math.round(m / 50) * 50)} m from you`;
  return `${(m / 1_000).toFixed(m < 10_000 ? 1 : 0)} km from you`;
}

export function IncidentCard({
  incident,
  reacted,
  onReact,
  onClose,
  from,
  language,
}: {
  incident: PublicIncident;
  /** This phone's earlier reaction, if any. */
  reacted: ReactionKind | null;
  /** Resolves to a message to show. */
  onReact: (kind: ReactionKind) => Promise<string>;
  onClose: () => void;
  /** The person's position, when known, for "350 m from you". */
  from: Position | null;
  language: Language;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const t = strings(language);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const category = getCategory(incident.categoryId);
  const title = categoryName(
    incident.categoryId,
    category ? publicLabelOf(category) : incident.categoryId,
    language,
  );
  const tone: Tone =
    incident.severity === "critical"
      ? "danger"
      : incident.severity === "high"
        ? "warning"
        : "advisory";
  const eyebrow =
    incident.severity === "critical"
      ? t.emergencyKey
      : incident.severity === "high"
        ? t.warningKey
        : t.advisoryKey;
  const eyebrowColor =
    tone === "danger" ? c.dangerText : tone === "warning" ? c.warningText : c.advisoryText;
  const step = CONFIDENCE_STEP[incident.label];
  const meta = [
    distanceText(from, incident),
    incident.active ? timeAgo(incident.lastReportAt) : `Ended ${timeAgo(incident.lastReportAt)}`,
    `${incident.reportCount} report${incident.reportCount === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <IconTile icon={category?.icon ?? "alert-circle"} tone={tone} size={52} />
        <View
          style={styles.titleWrap}
          accessible
          accessibilityLabel={`${eyebrow}: ${title}. ${incident.label}. ${meta}.`}
        >
          <Text style={[styles.eyebrow, { color: eyebrowColor }]}>{eyebrow}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta}>{meta}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={styles.close}
        >
          <Icon name="close" size={20} />
        </Pressable>
      </View>

      {step ? (
        <View style={styles.confidence}>
          <View style={styles.stepBars}>
            {STEP_NAMES.map((name, i) => (
              <View key={name} style={[styles.stepBar, i < step && styles.stepBarDone]} />
            ))}
          </View>
          <View style={styles.stepNames}>
            {STEP_NAMES.map((name, i) => (
              <Text key={name} style={[styles.stepName, i === step - 1 && styles.stepNameNow]}>
                {name}
              </Text>
            ))}
          </View>
          <Text style={styles.explain}>{LABEL_EXPLANATION[incident.label]}</Text>
        </View>
      ) : (
        <View style={styles.status}>
          <Icon
            name={incident.label === "Resolved" ? "check-circle" : "help-circle"}
            size={20}
            color={incident.label === "Resolved" ? c.primary : c.warningText}
          />
          <Text style={styles.statusText}>
            {incident.label}: {LABEL_EXPLANATION[incident.label]}
          </Text>
        </View>
      )}

      {incident.responder && (
        <View style={styles.responder}>
          <View style={styles.responderBadge}>
            <Icon name="shield-check" size={20} color="#FFFFFF" />
          </View>
          <View style={styles.titleWrap}>
            <Text style={styles.responderName}>{incident.responder.organisation}</Text>
            <Text style={styles.responderText}>
              {incident.responder.text} · {timeAgo(incident.responder.at)}
            </Text>
          </View>
        </View>
      )}

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
                  <Icon
                    name={REACTION_ICON[kind]}
                    size={22}
                    color={
                      kind === "confirm" ? c.warningText : kind === "over" ? c.primary : c.muted
                    }
                  />
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

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: 24,
      padding: 18,
      gap: 14,
      borderWidth: c.name === "dark" ? 1 : 0,
      borderColor: c.border,
      shadowColor: c.shadow,
      shadowOpacity: 0.16,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: -2 },
      elevation: 8,
    },
    head: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
    titleWrap: { flex: 1, gap: 2 },
    eyebrow: { fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
    title: { fontSize: 22, lineHeight: 26, fontWeight: "800", color: c.text },
    meta: { fontSize: 15, lineHeight: 20, color: c.muted },
    close: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceMuted,
    },
    confidence: { gap: 6 },
    stepBars: { flexDirection: "row", gap: 6 },
    stepBar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.border },
    stepBarDone: { backgroundColor: c.primary },
    stepNames: { flexDirection: "row", gap: 6 },
    stepName: { flex: 1, fontSize: 12.5, fontWeight: "700", color: c.muted },
    stepNameNow: { color: c.primary },
    explain: { fontSize: 15, color: c.text },
    status: { flexDirection: "row", alignItems: "center", gap: 8 },
    statusText: { flex: 1, fontSize: 15, color: c.text },
    responder: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderRadius: 16,
      backgroundColor: c.responderSoft,
    },
    responderBadge: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.responder,
    },
    responderName: { fontSize: 15, fontWeight: "700", color: c.responderText },
    responderText: { fontSize: 14, color: c.responderText },
    reactions: { gap: 10 },
    ask: { fontSize: 16, fontWeight: "700", color: c.text },
    reactionRow: { flexDirection: "row", gap: 8 },
    reaction: {
      flex: 1,
      minHeight: 70,
      paddingHorizontal: 6,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.borderStrong,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    reactionText: { color: c.text, fontSize: 14, fontWeight: "700", textAlign: "center" },
    pressed: { opacity: 0.6 },
    reacted: { color: c.primary, fontSize: 15, fontWeight: "700" },
    footnote: { fontSize: 13.5, lineHeight: 19, color: c.muted },
  });
