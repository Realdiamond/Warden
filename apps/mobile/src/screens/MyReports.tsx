import { getCategory, type ReportPublicStatus } from "@warden/shared";
import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Button, ModalHeader, Note } from "../components/ui.tsx";
import { STATUS_TEXT, timeAgo } from "../lib/format.ts";
import type { Outbox, PendingReport, RejectedReport, SavedReport } from "../lib/outbox.ts";
import type { DataSource } from "../lib/source.ts";
import { COLORS } from "../lib/ui.ts";

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
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
        ListEmptyComponent={
          loading ? null : (
            <Text style={styles.empty}>You have not sent any reports from this phone.</Text>
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
          return (
            <View style={styles.row}>
              <Text style={styles.title}>{category?.label ?? categoryId}</Text>
              <Text style={styles.meta}>
                {timeAgo(row.item.createdAt)} · {status}
              </Text>
            </View>
          );
        }}
        ListFooterComponent={
          <View style={styles.footer}>
            <Note>
              This list is kept only on this phone. If someone else might look at your phone, clear
              it.
            </Note>
            <Button label="Clear my history" variant="danger" onPress={clear} />
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  list: { padding: 16, gap: 10 },
  row: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  title: { fontSize: 16, fontWeight: "600", color: COLORS.text },
  meta: { color: COLORS.muted, marginTop: 4 },
  empty: { textAlign: "center", color: COLORS.muted, marginTop: 32 },
  footer: { marginTop: 16, gap: 12 },
});
