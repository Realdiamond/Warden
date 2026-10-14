import { getCategory } from "@warden/shared";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Icon, ModalHeader, Note } from "../components/ui.tsx";
import { type AlertState, alertTitle, describeDistance, type InboxEntry } from "../lib/alerts.ts";
import { timeAgo } from "../lib/format.ts";
import { COLORS } from "../lib/ui.ts";

const TIER_COLOR = { critical: "#B42318", warning: "#C2410C", advisory: "#2563EB" } as const;

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
}: {
  state: AlertState;
  placeCount: number;
  onOpen: (entry: InboxEntry) => void;
  onSettings: () => void;
  onClose: () => void;
}) {
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
          <Note>
            {placeCount === 0
              ? "Add your home, work or school and Warden will alert you about incidents near them. Your places stay on this phone."
              : "No alerts near your places. Warden checks every few minutes while the app is open, and from time to time when it is closed."}
          </Note>
        }
        renderItem={({ item }) => {
          const color =
            item.alert.kind === "resolved" ? COLORS.primary : TIER_COLOR[item.alert.tier];
          const title = alertTitle(item.alert);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${title}, near ${item.placeName}${item.read ? "" : ", new"}`}
              onPress={() => onOpen(item)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={[styles.iconWrap, { backgroundColor: `${color}22` }]}>
                <Icon name={iconFor(item)} color={color} />
              </View>
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
              </View>
              {!item.read && <View style={styles.dot} />}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { paddingHorizontal: 16, paddingBottom: 8 },
  list: { padding: 16, gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pressed: { opacity: 0.7 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 2 },
  title: { fontSize: 16, color: COLORS.text },
  unread: { fontWeight: "700" },
  meta: { color: COLORS.muted },
  message: { color: COLORS.text, marginTop: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.danger },
});
