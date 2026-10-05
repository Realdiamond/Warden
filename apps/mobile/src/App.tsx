import type { CameraRef } from "@maplibre/maplibre-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import type { BBox, PublicIncident, ReportSubmission, TimeWindow } from "@warden/shared";
import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { IncidentCard } from "./components/IncidentCard.tsx";
import { IncidentMap } from "./components/IncidentMap.tsx";
import { Button, Icon } from "./components/ui.tsx";
import { boundsToBBox } from "./lib/geo.ts";
import { currentPosition } from "./lib/location.ts";
import { Outbox } from "./lib/outbox.ts";
import { getInstallId, loadSettings, type Settings, saveSettings } from "./lib/settings.ts";
import { createSource } from "./lib/source.ts";
import { COLORS } from "./lib/ui.ts";
import { MyReports } from "./screens/MyReports.tsx";
import { ReportFlow, type SendOutcome } from "./screens/ReportFlow.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; mapStyleUrl?: string };
const BUILT_IN_API_URL = extra.apiUrl ?? "";
const MAP_STYLE_URL = extra.mapStyleUrl ?? "https://tiles.openfreemap.org/styles/liberty";
const WINDOWS: { value: TimeWindow; label: string }[] = [
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
];

export function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Root />
    </SafeAreaProvider>
  );
}

type Sheet = "report" | "mine" | "settings" | null;

function Root() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [installId, setInstallId] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<PublicIncident[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [window, setWindow] = useState<TimeWindow>("24h");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [online, setOnline] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showUser, setShowUser] = useState(false);
  const bboxRef = useRef<BBox | null>(null);
  const cameraRef = useRef<CameraRef>(null);
  const outbox = useMemo(() => new Outbox(AsyncStorage), []);

  useEffect(() => {
    void (async () => {
      setInstallId(await getInstallId(AsyncStorage, randomUUID));
      setSettings(await loadSettings(AsyncStorage, BUILT_IN_API_URL));
    })();
  }, []);

  const source = useMemo(
    () => (settings && installId ? createSource(settings, installId) : null),
    [settings, installId],
  );

  const refresh = useCallback(async () => {
    const bbox = bboxRef.current;
    if (!source || !bbox) return;
    try {
      setIncidents(await source.incidents(bbox, window));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [source, window]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Send queued reports whenever the connection comes back.
  useEffect(() => {
    if (!source) return;
    return NetInfo.addEventListener((state) => {
      const connected = state.isConnected !== false;
      setOnline(connected);
      if (connected) void outbox.flush(source.send).catch(() => undefined);
    });
  }, [source, outbox]);

  const regionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRegionChange = useCallback(
    (bounds: [number, number, number, number]) => {
      bboxRef.current = boundsToBBox(bounds);
      if (regionTimer.current) clearTimeout(regionTimer.current);
      regionTimer.current = setTimeout(() => void refresh(), 350);
    },
    [refresh],
  );

  const locateMe = useCallback(async () => {
    const position = await currentPosition(10_000);
    if (!position) return;
    setShowUser(true);
    cameraRef.current?.flyTo({ center: [position.lng, position.lat], zoom: 14 });
  }, []);

  const submit = useCallback(
    async (body: ReportSubmission): Promise<SendOutcome> => {
      if (!source)
        return { tone: "error", message: "The app is still starting. Please try again." };
      await outbox.add(body, randomUUID(), new Date());
      const result = await outbox
        .flush(source.send)
        .catch(() => ({ sent: 0, rejected: 0, waiting: 1 }));
      void refresh();
      if (result.sent > 0) {
        return {
          tone: "success",
          message:
            source.kind === "demo"
              ? "Demo mode: your report was not sent anywhere."
              : "Sent. Thank you. Trained staff will check it before it goes on the map if needed.",
        };
      }
      if (result.waiting > 0) {
        return {
          tone: "queued",
          message: "Saved on your phone. It will be sent as soon as you are online.",
        };
      }
      const [latest] = await outbox.rejected();
      return { tone: "error", message: latest?.message ?? "The report could not be sent." };
    },
    [source, outbox, refresh],
  );

  const saveNewSettings = useCallback(async (next: Settings) => {
    await saveSettings(AsyncStorage, next);
    setSettings(next);
    setSheet(null);
  }, []);

  if (!settings || !installId || !source) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const selected = incidents.find((incident) => incident.id === selectedId) ?? null;

  return (
    <View style={styles.screen}>
      <IncidentMap
        ref={cameraRef}
        styleUrl={MAP_STYLE_URL}
        incidents={incidents}
        showUser={showUser}
        onRegionChange={onRegionChange}
        onSelect={setSelectedId}
      />

      <SafeAreaView edges={["top"]} style={styles.top} pointerEvents="box-none">
        <View style={styles.chips}>
          {WINDOWS.map((item) => (
            <Pressable
              key={item.value}
              accessibilityRole="button"
              accessibilityState={{ selected: window === item.value }}
              accessibilityLabel={`Show the last ${item.label}`}
              onPress={() => setWindow(item.value)}
              style={[styles.chip, window === item.value && styles.chipActive]}
            >
              <Text style={[styles.chipText, window === item.value && styles.chipTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show my location"
            onPress={() => void locateMe()}
            style={styles.roundButton}
          >
            <Icon name="crosshairs-gps" color={COLORS.primary} />
          </Pressable>
        </View>
        {source.kind === "demo" && (
          <Text style={styles.banner}>Demo mode: sample data, not real incidents</Text>
        )}
        {!online && (
          <Text style={styles.banner}>You are offline. Showing the last loaded map.</Text>
        )}
        {online && loadError && source.kind === "live" && (
          <Text style={styles.banner}>Could not reach the Warden server.</Text>
        )}
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={styles.bottom} pointerEvents="box-none">
        {selected && <IncidentCard incident={selected} />}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="My reports"
            onPress={() => setSheet("mine")}
            style={styles.roundButton}
          >
            <Icon name="format-list-bulleted" color={COLORS.primary} />
          </Pressable>
          <View style={styles.reportButton}>
            <Button
              label="Report"
              variant="primary"
              icon="plus"
              onPress={() => setSheet("report")}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => setSheet("settings")}
            style={styles.roundButton}
          >
            <Icon name="cog" color={COLORS.primary} />
          </Pressable>
        </View>
      </SafeAreaView>

      <Modal visible={sheet !== null} animationType="slide" onRequestClose={() => setSheet(null)}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.modal}>
            {sheet === "report" && (
              <ReportFlow
                styleUrl={MAP_STYLE_URL}
                onClose={() => setSheet(null)}
                onSubmit={submit}
              />
            )}
            {sheet === "mine" && (
              <MyReports outbox={outbox} source={source} onClose={() => setSheet(null)} />
            )}
            {sheet === "settings" && (
              <SettingsScreen
                settings={settings}
                onSave={(next) => void saveNewSettings(next)}
                onClose={() => setSheet(null)}
              />
            )}
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  top: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: 12, gap: 8 },
  chips: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8 },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    justifyContent: "center",
    backgroundColor: COLORS.surface,
    elevation: 3,
  },
  chipActive: { backgroundColor: COLORS.primary },
  chipText: { color: COLORS.text, fontWeight: "600" },
  chipTextActive: { color: COLORS.primaryText },
  roundButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
    elevation: 3,
    marginLeft: "auto",
  },
  banner: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: COLORS.warningBg,
    color: COLORS.text,
    fontWeight: "600",
  },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 12, gap: 12 },
  actions: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 12 },
  reportButton: { flex: 1 },
  modal: { flex: 1, backgroundColor: COLORS.background },
});
