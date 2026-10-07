import type { CameraRef } from "@maplibre/maplibre-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import type {
  BBox,
  PublicIncident,
  PublicPresence,
  ReactionKind,
  ReportSubmission,
  TimeWindow,
} from "@warden/shared";
import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ensureBackgroundChecks, runStoredAlertCheck } from "./background.ts";
import { IncidentCard } from "./components/IncidentCard.tsx";
import { DEFAULT_CENTER, IncidentMap } from "./components/IncidentMap.tsx";
import { PresenceCard } from "./components/PresenceCard.tsx";
import { Button, EmergencyCallButton, Icon, ModalHeader, Note } from "./components/ui.tsx";
import {
  type AlertState,
  EMPTY_ALERT_STATE,
  type InboxEntry,
  loadAlertPrefs,
  loadAlertState,
  markAllRead,
  saveAlertState,
  unreadCount,
} from "./lib/alerts.ts";
import { boundsToBBox } from "./lib/geo.ts";
import { currentPosition } from "./lib/location.ts";
import { alertIdFromResponse, setUpNotifications, speakAlerts } from "./lib/notify.ts";
import { Outbox } from "./lib/outbox.ts";
import { loadPlaces, saveLastArea } from "./lib/places.ts";
import { loadReactions, type ReactionMemory, rememberReaction } from "./lib/reactions.ts";
import { type ActiveSession, loadActive, minutesLeft } from "./lib/safety.ts";
import { getInstallId, loadSettings, type Settings, saveSettings } from "./lib/settings.ts";
import { createSource } from "./lib/source.ts";
import { COLORS } from "./lib/ui.ts";
import {
  extendActive,
  finishActive,
  sendPendingEnds,
  startSafetySession,
} from "./safetyRuntime.ts";
import { AlertsScreen } from "./screens/AlertsScreen.tsx";
import { MyReports } from "./screens/MyReports.tsx";
import { PlacesScreen } from "./screens/PlacesScreen.tsx";
import { ReportFlow, type SendOutcome } from "./screens/ReportFlow.tsx";
import { SafetyScreen } from "./screens/SafetyScreen.tsx";
import { SessionScreen } from "./screens/SessionScreen.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";
import { SosCountdown } from "./screens/SosCountdown.tsx";
import { type TripPlan, TripScreen } from "./screens/TripScreen.tsx";

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

type Sheet =
  | "report"
  | "mine"
  | "settings"
  | "alerts"
  | "places"
  | "menu"
  | "safety"
  | "trip"
  | "session"
  | "sos"
  | "sosFailed"
  | null;

/** How often the open app checks for alerts. */
const ALERT_POLL_MS = 60_000;

function Root() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [installId, setInstallId] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<PublicIncident[]>([]);
  const [presence, setPresence] = useState<PublicPresence[]>([]);
  const [presenceId, setPresenceId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [window, setWindow] = useState<TimeWindow>("24h");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [online, setOnline] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showUser, setShowUser] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(EMPTY_ALERT_STATE);
  const [placeCount, setPlaceCount] = useState(0);
  const [reactions, setReactions] = useState<ReactionMemory>({});
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Start with the area around the default map centre so incidents load before the first pan.
  const bboxRef = useRef<BBox>(
    boundsToBBox([
      DEFAULT_CENTER[0] - 0.2,
      DEFAULT_CENTER[1] - 0.15,
      DEFAULT_CENTER[0] + 0.2,
      DEFAULT_CENTER[1] + 0.15,
    ]),
  );
  const cameraRef = useRef<CameraRef>(null);
  const outbox = useMemo(() => new Outbox(AsyncStorage), []);

  useEffect(() => {
    void (async () => {
      setInstallId(await getInstallId(AsyncStorage, randomUUID));
      setSettings(await loadSettings(AsyncStorage, BUILT_IN_API_URL));
      setAlertState(await loadAlertState(AsyncStorage));
      setPlaceCount((await loadPlaces(AsyncStorage)).length);
      setReactions(await loadReactions(AsyncStorage));
      setActive(await loadActive(AsyncStorage));
      void sendPendingEnds().catch(() => undefined);
      await setUpNotifications().catch(() => undefined);
      await ensureBackgroundChecks().catch(() => false);
    })();
  }, []);

  const source = useMemo(
    () => (settings && installId ? createSource(settings, installId) : null),
    [settings, installId],
  );

  const refresh = useCallback(async () => {
    const bbox = bboxRef.current;
    if (!source) return;
    try {
      setIncidents(await source.incidents(bbox, window));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
    // Deployments are extra information; the map works without them.
    source
      .presence(bbox)
      .then(setPresence)
      .catch(() => undefined);
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

  // Alerts: check now, every minute while open, and whenever the app comes back to the front.
  const checkAlertsNow = useCallback(async () => {
    try {
      const result = await runStoredAlertCheck({ notify: true });
      setAlertState(result.state);
      if (AppState.currentState === "active") speakAlerts(result.notifications);
    } catch {
      // Offline or server unreachable; the next check will catch up.
    }
  }, []);

  useEffect(() => {
    if (!source) return;
    void checkAlertsNow();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void checkAlertsNow();
    }, ALERT_POLL_MS);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void checkAlertsNow();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [source, checkAlertsNow]);

  const openAlert = useCallback((entry: InboxEntry) => {
    setSheet(null);
    setSelectedId(entry.alert.incidentId);
    cameraRef.current?.flyTo({
      center: [entry.alert.center.lng, entry.alert.center.lat],
      zoom: 14,
    });
  }, []);

  // Tapping a notification opens the map at that alert.
  useEffect(() => {
    const open = async (response: Notifications.NotificationResponse | null) => {
      const alertId = alertIdFromResponse(response);
      if (!alertId) return;
      const state = await loadAlertState(AsyncStorage);
      const entry = state.inbox.find((item) => item.alert.id === alertId);
      if (entry) openAlert(entry);
      else setSheet("alerts");
    };
    void Notifications.getLastNotificationResponseAsync().then(open);
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => void open(response),
    );
    return () => subscription.remove();
  }, [openAlert]);

  const closeAlerts = useCallback(async () => {
    setSheet(null);
    const state = markAllRead(await loadAlertState(AsyncStorage));
    await saveAlertState(AsyncStorage, state);
    setAlertState(state);
  }, []);

  const placesChanged = useCallback(async () => {
    setPlaceCount((await loadPlaces(AsyncStorage)).length);
    void checkAlertsNow();
  }, [checkAlertsNow]);

  const react = useCallback(
    async (incidentId: string, kind: ReactionKind): Promise<string> => {
      if (!source) return "The app is still starting.";
      try {
        const result = await source.react(incidentId, kind);
        if (!result) return "This incident is already closed.";
        setReactions(await rememberReaction(AsyncStorage, reactions, incidentId, kind));
        void refresh();
        if (!result.accepted) return "Your phone was already counted for this incident.";
        return result.label ? `Thank you. Now shown as: ${result.label}.` : "Thank you.";
      } catch {
        return "No connection. Please try again.";
      }
    },
    [source, reactions, refresh],
  );

  // Trips and SOS. The location service updates storage; the screen reads it back.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      void loadActive(AsyncStorage).then(setActive);
    }, 30_000);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6_000);
    return () => clearTimeout(timer);
  }, [toast]);

  const startTrip = useCallback(async (plan: TripPlan): Promise<string | null> => {
    const result = await startSafetySession("trip", {
      expectedArrivalAt: new Date(Date.now() + plan.minutes * 60_000).toISOString(),
      destination: plan.destination,
      note: plan.note,
    });
    if (!result.ok) return `Could not start: ${result.message}`;
    setActive(result.session);
    setSheet("session");
    if (!result.sharing) setToast("Location permission is needed to share your trip.");
    return null;
  }, []);

  const sendSos = useCallback(async () => {
    setSheet("session");
    const result = await startSafetySession("sos");
    if (!result.ok) {
      setSheet("sosFailed");
      return;
    }
    setActive(result.session);
  }, []);

  const finish = useCallback(async (outcome: "arrived" | "safe" | "cancelled", duress: boolean) => {
    const sent = await finishActive(outcome, duress);
    setActive(null);
    setSheet(null);
    // The same words whether or not a duress PIN was used.
    setToast(
      sent
        ? "Stopped sharing your location."
        : "Stopped. Your contacts will be told when you are back online.",
    );
  }, []);

  const extend = useCallback(async (minutes: number) => {
    const updated = await extendActive(minutes);
    if (updated) setActive(updated);
    else setToast("Could not add time. Check your connection and try again.");
  }, []);

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
    if ((await loadAlertPrefs(AsyncStorage)).aroundMe) {
      await saveLastArea(AsyncStorage, position, new Date());
    }
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
  const unread = unreadCount(alertState);
  const selectedPresence = presence.find((item) => item.id === presenceId) ?? null;
  const mapCenter = {
    lat: (bboxRef.current.minLat + bboxRef.current.maxLat) / 2,
    lng: (bboxRef.current.minLng + bboxRef.current.maxLng) / 2,
  };

  return (
    <View style={styles.screen}>
      <IncidentMap
        ref={cameraRef}
        styleUrl={MAP_STYLE_URL}
        incidents={incidents}
        presence={presence}
        showUser={showUser}
        onRegionChange={onRegionChange}
        onSelect={(id) => {
          setSelectedId(id);
          if (id) setPresenceId(null);
        }}
        onSelectPresence={(id) => {
          setPresenceId(id);
          if (id) setSelectedId(null);
        }}
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
          <View style={styles.topButtons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={unread > 0 ? `Alerts, ${unread} new` : "Alerts"}
              onPress={() => setSheet("alerts")}
              style={styles.roundButton}
            >
              <Icon name={unread > 0 ? "bell-ring" : "bell-outline"} color={COLORS.primary} />
              {unread > 0 && <Text style={styles.badge}>{unread > 9 ? "9+" : String(unread)}</Text>}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show my location"
              onPress={() => void locateMe()}
              style={styles.roundButton}
            >
              <Icon name="crosshairs-gps" color={COLORS.primary} />
            </Pressable>
          </View>
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
        {active && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setSheet("session")}
            style={[styles.sessionBanner, active.kind === "sos" && styles.sessionBannerSos]}
          >
            <Icon
              name={active.kind === "sos" ? "alarm-light" : "map-marker-path"}
              color="#FFFFFF"
            />
            <Text style={styles.sessionBannerText}>
              {active.kind === "sos" ? "SOS is on. Tap to manage." : tripBanner(active)}
            </Text>
          </Pressable>
        )}
        {toast && <Text style={styles.banner}>{toast}</Text>}
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={styles.bottom} pointerEvents="box-none">
        {selectedPresence && <PresenceCard presence={selectedPresence} />}
        {selected && (
          <IncidentCard
            key={selected.id}
            incident={selected}
            reacted={reactions[selected.id] ?? null}
            onReact={(kind) => react(selected.id, kind)}
          />
        )}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="SOS: alert my trusted contacts"
            onPress={() => setSheet(active ? "session" : "sos")}
            style={styles.sosButton}
          >
            <Text style={styles.sosText}>SOS</Text>
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
            accessibilityLabel="Share my trip"
            onPress={() => setSheet(active ? "session" : "trip")}
            style={styles.roundButton}
          >
            <Icon name="map-marker-path" color={COLORS.primary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Menu"
            onPress={() => setSheet("menu")}
            style={styles.roundButton}
          >
            <Icon name="menu" color={COLORS.primary} />
          </Pressable>
        </View>
      </SafeAreaView>

      <Modal visible={sheet !== null} animationType="slide" onRequestClose={() => setSheet(null)}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.modal}>
            {sheet === "report" && (
              <ReportFlow
                styleUrl={MAP_STYLE_URL}
                mapCenter={mapCenter}
                onClose={() => setSheet(null)}
                onSubmit={submit}
              />
            )}
            {sheet === "mine" && (
              <MyReports outbox={outbox} source={source} onClose={() => setSheet(null)} />
            )}
            {sheet === "alerts" && (
              <AlertsScreen
                state={alertState}
                placeCount={placeCount}
                onOpen={(entry) => {
                  void closeAlerts();
                  openAlert(entry);
                }}
                onSettings={() => setSheet("places")}
                onClose={() => void closeAlerts()}
              />
            )}
            {sheet === "places" && (
              <PlacesScreen
                styleUrl={MAP_STYLE_URL}
                mapCenter={mapCenter}
                onBack={() => setSheet("alerts")}
                onClose={() => setSheet(null)}
                onChanged={() => void placesChanged()}
              />
            )}
            {sheet === "menu" && (
              <View style={styles.menu}>
                <ModalHeader title="Menu" onClose={() => setSheet(null)} />
                <View style={styles.menuItems}>
                  <Button
                    label="My reports"
                    icon="format-list-bulleted"
                    onPress={() => setSheet("mine")}
                  />
                  <Button
                    label="Alerts and places"
                    icon="bell-outline"
                    onPress={() => setSheet("alerts")}
                  />
                  <Button
                    label="Safety contacts and PIN"
                    icon="account-heart"
                    onPress={() => setSheet("safety")}
                  />
                  <Button
                    label="Share my trip"
                    icon="map-marker-path"
                    onPress={() => setSheet(active ? "session" : "trip")}
                  />
                  <Button label="Settings" icon="cog" onPress={() => setSheet("settings")} />
                  <EmergencyCallButton />
                </View>
              </View>
            )}
            {sheet === "safety" && <SafetyScreen onClose={() => setSheet(null)} />}
            {sheet === "trip" && (
              <TripScreen
                styleUrl={MAP_STYLE_URL}
                mapCenter={mapCenter}
                onStart={startTrip}
                onContacts={() => setSheet("safety")}
                onClose={() => setSheet(null)}
              />
            )}
            {sheet === "sos" && (
              <SosCountdown onSend={() => void sendSos()} onCancel={() => setSheet(null)} />
            )}
            {sheet === "session" &&
              (active ? (
                <SessionScreen
                  session={active}
                  demo={active.feedId === "demo"}
                  onExtend={extend}
                  onFinish={finish}
                  onClose={() => setSheet(null)}
                />
              ) : (
                <View style={styles.loading}>
                  <ActivityIndicator size="large" color={COLORS.danger} />
                </View>
              ))}
            {sheet === "sosFailed" && (
              <View style={styles.menu}>
                <ModalHeader title="SOS" onClose={() => setSheet(null)} />
                <View style={styles.menuItems}>
                  <Note tone="warning">
                    Warden could not be reached, so your contacts were not alerted. Call 112 or text
                    someone you trust.
                  </Note>
                  <EmergencyCallButton />
                  <Button
                    label="Try again"
                    variant="danger"
                    icon="alarm-light"
                    onPress={() => void sendSos()}
                  />
                </View>
              </View>
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

function tripBanner(session: ActiveSession): string {
  const left = minutesLeft(session, new Date());
  if (left === null) return "Sharing your trip. Tap to manage.";
  return left >= 0
    ? `Sharing your trip · ${left} min left`
    : `Sharing your trip · ${-left} min late`;
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
  topButtons: { flexDirection: "row", gap: 8, marginLeft: "auto" },
  roundButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
    elevation: 3,
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 4,
    overflow: "hidden",
    backgroundColor: COLORS.danger,
    color: COLORS.primaryText,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 20,
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
  sosButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.danger,
    elevation: 4,
  },
  sosText: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },
  sessionBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    elevation: 3,
  },
  sessionBannerSos: { backgroundColor: COLORS.danger },
  sessionBannerText: { color: "#FFFFFF", fontWeight: "700" },
  menu: { flex: 1 },
  menuItems: { padding: 16, gap: 12 },
  modal: { flex: 1, backgroundColor: COLORS.background },
});
