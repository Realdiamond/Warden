import { getCategory } from "@warden/shared";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { BroadcastAudio } from "../components/BroadcastAudio.tsx";
import { Text } from "../components/text.tsx";
import { useStyles } from "../components/theme.tsx";
import { Button, IconTile, ModalHeader, Note, type Tone } from "../components/ui.tsx";
import { type AlertState, alertTitle, describeDistance, type InboxEntry } from "../lib/alerts.ts";
import { timeAgo } from "../lib/format.ts";
import type { Palette } from "../lib/theme.ts";

const TIER_TONE: Record<InboxEntry["alert"]["tier"], Tone> = {
  critical: "danger",
  warning: "warning",
  advisory: "advisory",
};

function iconFor(entry: InboxEntry): string {
  const { alert } = entry;
  if (alert.kind === "broadcast") return "bullhorn";
  if (alert.kind === "resolved") return "check-circle";
  const category = alert.categoryId ? getCategory(alert.categoryId) : undefined;
  return category?.icon ?? "alert-circle";
}

export function AlertsScreen({
  state,
  placeCount,
  onOpen,
  onSettings,
  onClose,
  downloadAudio,
}: {
  /** Fetches a broadcast's spoken version (M8). */
  downloadAudio: (broadcastId: string) => Promise<Uint8Array | null>;
  state: AlertState;
  placeCount: number;
  onOpen: (entry: InboxEntry) => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.screen}>
      <ModalHeader title="Alerts" onClose={onClose} />
      <View style={styles.top}>
        <Button
          label={placeCount === 0 ? "Add your places" : "Places and alert settings"}
          icon="map-marker-radius"
          variant={placeCount === 0 ? "primary" : "secondary"}
          onPress={onSettings}
        />
      </View>
      <FlatList
        data={state.inbox}
        keyExtractor={(entry) => entry.alert.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Note icon={placeCount === 0 ? "map-marker-plus-outline" : "bell-check-outline"}>
            {placeCount === 0
              ? "Add your home, work or school and Warden will alert you about incidents near them. Your places stay on this phone."
              : "No alerts near your places. Warden checks every few minutes while the app is open, and from time to time when it is closed."}
          </Note>
        }
        renderItem={({ item }) => {
          const tone: Tone =
            item.alert.kind === "resolved" ? "primary" : TIER_TONE[item.alert.tier];
          const title = alertTitle(item.alert);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${title}, near ${item.placeName}${item.read ? "" : ", new"}`}
              onPress={() => onOpen(item)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <IconTile icon={iconFor(item)} tone={tone} size={44} round />
              <View style={styles.rowText}>
                <Text style={[styles.title, !item.read && styles.unread]}>{title}</Text>
                <Text style={styles.meta}>
                  {item.alert.source === "demo" ? "Demo · " : ""}
                  {item.alert.kind === "broadcast"
                    ? item.verified
                      ? "Verified by Warden · "
                      : "Not verified · "
                    : ""}
                  Near {item.placeName} · {describeDistance(item.distanceM)} ·{" "}
                  {timeAgo(item.alert.visibleAt)}
                </Text>
                {item.alert.message ? (
                  <Text style={styles.message}>{item.alert.message}</Text>
                ) : null}
                {item.alert.broadcast && item.verified ? (
                  <BroadcastAudio broadcast={item.alert.broadcast} download={downloadAudio} />
                ) : null}
              </View>
              {!item.read && <View style={styles.dot} />}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    top: { paddingHorizontal: 16, paddingBottom: 4 },
    list: { padding: 16, gap: 10 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 14,
      borderRadius: 18,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    pressed: { opacity: 0.75 },
    rowText: { flex: 1, gap: 3 },
    title: { fontSize: 16, fontWeight: "500", color: c.text },
    unread: { fontWeight: "800" },
    meta: { color: c.muted, fontSize: 14, lineHeight: 19 },
    message: { color: c.text, fontSize: 15, lineHeight: 21, marginTop: 4 },
    dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: c.danger },
  });
