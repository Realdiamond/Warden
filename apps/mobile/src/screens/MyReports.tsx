import { getCategory, type ReportPublicStatus } from "@warden/shared";
import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { Text } from "../components/text.tsx";
import { useStyles, useTheme } from "../components/theme.tsx";
import { Button, IconTile, ModalHeader, Note, type Tone } from "../components/ui.tsx";
import { STATUS_TEXT, timeAgo } from "../lib/format.ts";
import type { Outbox, PendingReport, RejectedReport, SavedReport } from "../lib/outbox.ts";
import type { DataSource } from "../lib/source.ts";
import type { Palette } from "../lib/theme.ts";
import { GROUP_TONES } from "../lib/ui.ts";

type Row =
  | { kind: "pending"; item: PendingReport }
  | { kind: "sent"; item: SavedReport; status: ReportPublicStatus | "unknown" }
  | { kind: "rejected"; item: RejectedReport };

export function MyReports({
  outbox,
  source,
  onClose,
}: {
  outbox: Outbox;
  source: DataSource;
  onClose: () => void;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    await outbox.flush(source.send).catch(() => undefined);
    const [pending, sent, rejected] = await Promise.all([
      outbox.pending(),
      outbox.sent(),
      outbox.rejected(),
    ]);
    const statuses = await Promise.all(
      sent.map((item) =>
        source
          .status(item.reportId, item.statusToken)
          .then((result) => result?.status ?? "unknown")
          .catch(() => "unknown" as const),
      ),
    );
    setRows([
      ...pending.map((item): Row => ({ kind: "pending", item })),
      ...sent.map((item, i): Row => ({ kind: "sent", item, status: statuses[i] ?? "unknown" })),
      ...rejected.map((item): Row => ({ kind: "rejected", item })),
    ]);
    setLoading(false);
  }, [outbox, source]);

  useEffect(() => {
    void load();
  }, [load]);

  const clear = () =>
    Alert.alert(
      "Clear your report history?",
      "This removes the list of your reports from this phone. Reports already sent stay with Warden.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => void outbox.clearHistory().then(load),
        },
      ],
    );

  return (
    <View style={styles.screen}>
      <ModalHeader title="My reports" onClose={onClose} />
      <FlatList
        contentContainerStyle={styles.list}
        data={rows}
        keyExtractor={(row, index) => `${row.kind}-${index}`}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load()}
            colors={[c.primary]}
            tintColor={c.primary}
            progressBackgroundColor={c.surface}
          />
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <IconTile icon="format-list-bulleted" tone="neutral" size={56} />
              <Text style={styles.emptyText}>You have not sent any reports from this phone.</Text>
            </View>
          )
        }
        renderItem={({ item: row }) => {
          const categoryId =
            row.kind === "pending" ? row.item.body.categoryId : row.item.categoryId;
          const category = getCategory(categoryId);
          const status =
            row.kind === "pending"
              ? "Waiting to send"
              : row.kind === "rejected"
                ? `Not accepted: ${row.item.message}`
                : row.status === "unknown"
                  ? "Status not available"
                  : STATUS_TEXT[row.status];
          const statusTone: Tone =
            row.kind === "pending" ? "warning" : row.kind === "rejected" ? "danger" : "neutral";
          const statusColor =
            statusTone === "warning"
              ? c.warningText
              : statusTone === "danger"
                ? c.dangerText
                : c.muted;
          return (
            <View style={styles.row}>
              <IconTile
                icon={category?.icon ?? "alert-circle-outline"}
                tone={category ? GROUP_TONES[category.group] : "neutral"}
                size={44}
              />
              <View style={styles.rowText}>
                <Text style={styles.title}>{category?.label ?? categoryId}</Text>
                <Text style={styles.meta}>
                  {timeAgo(row.item.createdAt)} ·{" "}
                  <Text style={[styles.status, { color: statusColor }]}>{status}</Text>
                </Text>
              </View>
            </View>
          );
        }}
        ListFooterComponent={
          <View style={styles.footer}>
            <Note icon="cellphone-lock">
              This list is kept only on this phone. If someone else might look at your phone, clear
              it.
            </Note>
            <Button label="Clear my history" variant="dangerOutline" onPress={clear} />
          </View>
        }
      />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
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
    rowText: { flex: 1, gap: 3 },
    title: { fontSize: 16, fontWeight: "700", color: c.text },
    meta: { color: c.muted, fontSize: 14, lineHeight: 19 },
    status: { fontWeight: "700" },
    empty: { alignItems: "center", gap: 12, marginTop: 40, paddingHorizontal: 24 },
    emptyText: { textAlign: "center", color: c.muted, fontSize: 16, lineHeight: 22 },
    footer: { marginTop: 16, gap: 12 },
  });
