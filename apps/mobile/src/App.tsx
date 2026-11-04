import type { CameraRef } from "@maplibre/maplibre-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import {
  type BBox,
  LEGAL_VERSION,
  type PublicIncident,
  type PublicPresence,
  type ReactionKind,
  type ReportSubmission,
  type TimeWindow,
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
  ScrollView,
  StyleSheet,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ensureBackgroundChecks, runStoredAlertCheck } from "./background.ts";
import { IncidentCard } from "./components/IncidentCard.tsx";
import {
  CITY_ZOOM,
  DEFAULT_CENTER,
  IncidentMap,
  type RegionChange,
  STREET_ZOOM,
} from "./components/IncidentMap.tsx";
import { PresenceCard } from "./components/PresenceCard.tsx";
import { areaAround } from "./components/SafePlaces.tsx";
import { SosSoundRecorder } from "./components/SosSoundRecorder.tsx";
import { Text } from "./components/text.tsx";
import { ThemeProvider, useMapStyle, useStyles, useTheme } from "./components/theme.tsx";
import {
  Button,
  Card,
  Divider,
  EmergencyCallButton,
  Icon,
  ListRow,
  ModalHeader,
  Note,
  SectionLabel,
  SegmentedControl,
} from "./components/ui.tsx";
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
import { loadProfile, type SafetyProfile } from "./lib/contacts.ts";
import { boundsToBBox, insideBBox } from "./lib/geo.ts";
import { strings } from "./lib/i18n.ts";
import type { Position } from "./lib/location.ts";
import { currentPosition, knownPosition } from "./lib/location.ts";
import { NEAR_RADIUS_M, nearSummary } from "./lib/mapFeatures.ts";
import type { Attachment } from "./lib/media.ts";
import { removeLeftovers } from "./lib/mediaFiles.ts";
import { alertIdFromResponse, setUpNotifications, speakAlerts } from "./lib/notify.ts";
import { acceptedLegalVersion, acceptLegal, isOnboarded, markOnboarded } from "./lib/onboarding.ts";
import { Outbox } from "./lib/outbox.ts";
import { loadPins } from "./lib/pin.ts";
import { loadPlaces, type SavedPlace, saveLastArea } from "./lib/places.ts";
import { loadReactions, type ReactionMemory, rememberReaction } from "./lib/reactions.ts";
import { type ActiveSession, loadActive, minutesLeft } from "./lib/safety.ts";
import { getInstallId, loadSettings, type Settings, saveSettings } from "./lib/settings.ts";
import { createSource } from "./lib/source.ts";
import { MONO, type Palette, resolveTheme, type ThemeSetting } from "./lib/theme.ts";
import { flushMedia, mediaQueue } from "./mediaRuntime.ts";
import {
  answerCheckInActive,
  checkActiveCheckIn,
  extendActive,
  finishActive,
  sendPendingEnds,
  startSafetySession,
} from "./safetyRuntime.ts";
import { AlertsScreen } from "./screens/AlertsScreen.tsx";
import { CommunityScreen } from "./screens/CommunityScreen.tsx";
import { type LegalDocumentId, LegalScreen } from "./screens/LegalScreen.tsx";
import { MyReports } from "./screens/MyReports.tsx";
import { Onboarding } from "./screens/Onboarding.tsx";
import { OutlookScreen } from "./screens/OutlookScreen.tsx";
import { PlacesScreen } from "./screens/PlacesScreen.tsx";
import { ReportFlow, type SendOutcome } from "./screens/ReportFlow.tsx";
import { SafetyScreen } from "./screens/SafetyScreen.tsx";
import { SessionScreen } from "./screens/SessionScreen.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";
import { SosCountdown } from "./screens/SosCountdown.tsx";
import { type TripPlan, TripScreen } from "./screens/TripScreen.tsx";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };
const BUILT_IN_API_URL = extra.apiUrl ?? "";
const WINDOWS: { value: TimeWindow; label: string; spoken: string }[] = [
  { value: "6h", label: "6 h", spoken: "6 hours" },
  { value: "24h", label: "24 h", spoken: "24 hours" },
  { value: "7d", label: "7 days", spoken: "7 days" },
];
interface StartView {
  center: [number, number];
  zoom: number;
}
const CITY_VIEW: StartView = { center: DEFAULT_CENTER, zoom: CITY_ZOOM };
/** How long the map waits for the phone's position before opening on the city. */
const START_WAIT_MS = 1_500;
/** Below this zoom the summary talks about the area on screen, not about "near you". */
const NEIGHBOURHOOD_ZOOM = 12.5;

export function App() {
  return (
    <SafeAreaProvider>
      <Themed />
    </SafeAreaProvider>
  );
}

/** Night mode follows the phone unless the person chose otherwise in Settings. */
function Themed() {
  const system = useColorScheme();
  const [setting, setSetting] = useState<ThemeSetting>("system");
  const palette = resolveTheme(setting, system);
  return (
    <ThemeProvider palette={palette}>
      <StatusBar style={palette.statusBar} />
      <Root onTheme={setSetting} />
    </ThemeProvider>
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
  | "community"
  | "outlook"
  | "legal"
  | null;

/** How often the open app checks for alerts. */
const ALERT_POLL_MS = 60_000;

function Root({ onTheme }: { onTheme: (setting: ThemeSetting) => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const mapStyle = useMapStyle();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [installId, setInstallId] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [incidents, setIncidents] = useState<PublicIncident[]>([]);
  const [presence, setPresence] = useState<PublicPresence[]>([]);
  const [presenceId, setPresenceId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [window, setWindow] = useState<TimeWindow>("24h");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [online, setOnline] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [userPosition, setUserPosition] = useState<Position | null>(null);
  const [zoom, setZoom] = useState(CITY_ZOOM);
  const [alertState, setAlertState] = useState<AlertState>(EMPTY_ALERT_STATE);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [profile, setProfile] = useState<SafetyProfile | null>(null);
  const [pinSet, setPinSet] = useState(false);
  const [reactions, setReactions] = useState<ReactionMemory>({});
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** The privacy notice and terms version accepted on this phone; undefined while loading. */
  const [legalAccepted, setLegalAccepted] = useState<string | null | undefined>(undefined);
  const [legalDoc, setLegalDoc] = useState<LegalDocumentId>("privacy");
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
  const outbox = useMemo(() => new Outbox(AsyncStorage, mediaQueue), []);

  /** Contacts, PIN and places, which the menu and the first-run setup summarise. */
  const reloadSafety = useCallback(async () => {
    const [nextProfile, pins, nextPlaces] = await Promise.all([
      loadProfile(AsyncStorage),
      loadPins(AsyncStorage),
      loadPlaces(AsyncStorage),
    ]);
    setProfile(nextProfile);
    setPinSet(!!pins?.pinHash);
    setPlaces(nextPlaces);
    return { profile: nextProfile, places: nextPlaces };
  }, []);

  useEffect(() => {
    void (async () => {
      // Files from an earlier run that nothing is waiting to send.
      const waiting = [
        ...(await mediaQueue.pending()).map((item) => item.uri),
        ...(await outbox.pending()).flatMap((r) => (r.attachments ?? []).map((a) => a.uri)),
      ];
      try {
        removeLeftovers(new Set(waiting));
      } catch {
        // Tidying up can wait for the next start.
      }
      setInstallId(await getInstallId(AsyncStorage, randomUUID));
      const loaded = await loadSettings(AsyncStorage, BUILT_IN_API_URL);
      setSettings(loaded);
      onTheme(loaded.theme);
      setAlertState(await loadAlertState(AsyncStorage));
      const safety = await reloadSafety();
      // People who set things up before the first-run screens existed skip them.
      const done =
        (await isOnboarded(AsyncStorage)) ||
        safety.profile.contacts.length > 0 ||
        safety.places.length > 0;
      if (done) await markOnboarded(AsyncStorage);
      setOnboarded(done);
      setReactions(await loadReactions(AsyncStorage));
      setLegalAccepted(await acceptedLegalVersion(AsyncStorage));
      setActive(await loadActive(AsyncStorage));
      void sendPendingEnds().catch(() => undefined);
      await setUpNotifications().catch(() => undefined);
      await ensureBackgroundChecks().catch(() => false);
    })();
  }, [outbox, reloadSafety, onTheme]);

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

  // Open the map on the person's own area when the phone already allows location. The map waits
  // up to START_WAIT_MS for a position so it can start there; a later fix moves the camera.
  const mapReady = onboarded === true && !!source;
  const [start, setStart] = useState<StartView | null>(null);
  const startRef = useRef<StartView | null>(null);
  useEffect(() => {
    if (!mapReady) return;
    let cancelled = false;
    const begin = (view: StartView) => {
      if (startRef.current) return false;
      startRef.current = view;
      const [lng, lat] = view.center;
      const half = view.zoom >= STREET_ZOOM ? 0.03 : 0.2;
      bboxRef.current = boundsToBBox([lng - half, lat - half, lng + half, lat + half]);
      setStart(view);
      return true;
    };
    const timer = setTimeout(() => begin(CITY_VIEW), START_WAIT_MS);
    void knownPosition().then((position) => {
      if (cancelled) return;
      if (!position) {
        begin(CITY_VIEW);
        return;
      }
      setUserPosition(position);
      const view: StartView = { center: [position.lng, position.lat], zoom: STREET_ZOOM };
      if (!begin(view)) cameraRef.current?.flyTo(view);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mapReady]);

  // Send queued reports whenever the connection comes back.
  useEffect(() => {
    if (!source) return;
    return NetInfo.addEventListener((state) => {
      const connected = state.isConnected !== false;
      setOnline(connected);
      if (connected) {
        void outbox
          .flush(source.send)
          .catch(() => undefined)
          .then(() => flushMedia())
          .catch(() => undefined);
      }
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
      zoom: STREET_ZOOM,
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
    setPlaces(await loadPlaces(AsyncStorage));
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
      // Also tells contacts about an unanswered "Are you OK?" while the app is open.
      void checkActiveCheckIn()
        .catch(() => undefined)
        .then(() => loadActive(AsyncStorage))
        .then(setActive);
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

  const answerCheckIn = useCallback(async (duress: boolean) => {
    const answered = await answerCheckInActive(duress);
    if (answered) setActive(answered);
  }, []);

  const findRouteIncidents = useCallback(
    (bbox: BBox) => (source ? source.incidents(bbox, "7d") : Promise.resolve([])),
    [source],
  );

  const findStops = useCallback(
    (around: Position) => (source ? source.safeStops(areaAround(around)) : Promise.resolve([])),
    [source],
  );

  const extend = useCallback(async (minutes: number) => {
    const updated = await extendActive(minutes);
    if (updated) setActive(updated);
    else setToast("Could not add time. Check your connection and try again.");
  }, []);

  const regionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRegionChange = useCallback(
    (region: RegionChange) => {
      bboxRef.current = boundsToBBox(region.bounds);
      setZoom(region.zoom);
      if (regionTimer.current) clearTimeout(regionTimer.current);
      regionTimer.current = setTimeout(() => void refresh(), 350);
    },
    [refresh],
  );

  const locateMe = useCallback(async () => {
    const position = await currentPosition(10_000);
    if (!position) {
      setToast("Location is off for Warden. You can allow it in your phone's settings.");
      return;
    }
    setUserPosition(position);
    cameraRef.current?.flyTo({ center: [position.lng, position.lat], zoom: STREET_ZOOM });
    if ((await loadAlertPrefs(AsyncStorage)).aroundMe) {
      await saveLastArea(AsyncStorage, position, new Date());
    }
  }, []);

  const submit = useCallback(
    async (body: ReportSubmission, attachments: Attachment[]): Promise<SendOutcome> => {
      if (!source)
        return { tone: "error", message: "The app is still starting. Please try again." };
      await outbox.add(body, randomUUID(), new Date(), attachments);
      const result = await outbox
        .flush(source.send)
        .catch(() => ({ sent: 0, rejected: 0, waiting: 1 }));
      void refresh();
      if (attachments.length > 0) void flushMedia().catch(() => undefined);
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

  const t = strings(settings?.language);

  const saveNewSettings = useCallback(
    async (next: Settings) => {
      await saveSettings(AsyncStorage, next);
      setSettings(next);
      onTheme(next.theme);
      setSheet(null);
    },
    [onTheme],
  );

  const finishOnboarding = useCallback(async () => {
    await markOnboarded(AsyncStorage);
    await reloadSafety();
    setLegalAccepted(await acceptedLegalVersion(AsyncStorage));
    setOnboarded(true);
  }, [reloadSafety]);

  const openSheet = useCallback(
    (next: Sheet) => {
      if (next === "menu") void reloadSafety();
      setSheet(next);
    },
    [reloadSafety],
  );

  if (!settings || !installId || !source || onboarded === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  if (!onboarded) {
    return (
      <Onboarding
        settings={settings}
        onLanguage={(language) => void saveNewSettings({ ...settings, language })}
        onDone={() => void finishOnboarding()}
      />
    );
  }

  if (!start) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={c.primary} />
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

  // "Near you" when the person is on screen and the map is close in; otherwise the area shown.
  const nearMe =
    userPosition !== null &&
    zoom >= NEIGHBOURHOOD_ZOOM &&
    insideBBox(userPosition, bboxRef.current);
  const near = nearSummary(incidents, nearMe && userPosition ? userPosition : mapCenter);
  const hour = new Date().getHours();
  const night = hour >= 19 || hour < 6;
  const levelColor =
    near.level === "danger" ? c.critical : near.level === "caution" ? c.warning : c.primary;
  const windowText = t.lastWindow[window];
  const summaryTitle = !nearMe
    ? t.reportsInView(incidents.length, windowText)
    : near.level === "danger"
      ? t.dangerNearby
      : near.level === "caution"
        ? t.takeCareNearby
        : night
          ? t.quietTonight
          : t.quietNearYou;
  const summaryLine = nearMe
    ? t.reportsWithin(near.count, NEAR_RADIUS_M / 1000, windowText)
    : zoom < NEIGHBOURHOOD_ZOOM && incidents.length > 0
      ? t.tapCircle
      : null;
  const contactNames = (profile?.contacts ?? []).map((contact) => contact.name);
  const readyForSos = contactNames.length > 0;

  return (
    <View style={styles.screen}>
      <SosSoundRecorder session={active} />
      <IncidentMap
        ref={cameraRef}
        incidents={incidents}
        presence={presence}
        showUser={userPosition !== null}
        language={settings.language}
        initialCenter={start.center}
        initialZoom={start.zoom}
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
        <View style={styles.summary} accessible accessibilityRole="summary">
          <Text style={styles.summaryEyebrow}>{nearMe ? t.nearYou : t.inThisArea}</Text>
          <View style={styles.summaryTitleRow}>
            {nearMe ? <View style={[styles.levelDot, { backgroundColor: levelColor }]} /> : null}
            <Text style={styles.summaryTitle}>{summaryTitle}</Text>
          </View>
          {summaryLine ? <Text style={styles.summaryLine}>{summaryLine}</Text> : null}
          <View style={styles.key}>
            <KeyItem color={c.critical} label={t.emergencyKey} />
            <KeyItem color={c.warning} label={t.warningKey} />
            <KeyItem color={c.advisory} label={t.advisoryKey} />
            <KeyItem color={c.responder} label={t.respondersKey} dashed />
          </View>
        </View>
        <View style={styles.controls} pointerEvents="box-none">
          <SegmentedControl
            options={WINDOWS.map((item) => ({
              value: item.value,
              label: item.label,
              accessibilityLabel: `Show the last ${item.spoken}`,
            }))}
            value={window}
            onChange={setWindow}
          />
          <View style={styles.topButtons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={unread > 0 ? `Alerts, ${unread} new` : "Alerts"}
              onPress={() => openSheet("alerts")}
              style={styles.roundButton}
            >
              <Icon name={unread > 0 ? "bell-ring" : "bell-outline"} color={c.primary} />
              {unread > 0 && <Text style={styles.badge}>{unread > 9 ? "9+" : String(unread)}</Text>}
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
            onPress={() => openSheet("session")}
            style={[
              styles.sessionBanner,
              (active.kind === "sos" || !!active.checkIn) && styles.sessionBannerSos,
            ]}
          >
            <Icon
              name={
                active.checkIn ? "alert" : active.kind === "sos" ? "alarm-light" : "map-marker-path"
              }
              color={active.kind === "sos" || active.checkIn ? c.onDanger : c.onPrimary}
            />
            <Text
              style={[
                styles.sessionBannerText,
                (active.kind === "sos" || active.checkIn) && styles.sessionBannerTextSos,
              ]}
            >
              {active.checkIn
                ? t.areYouOk
                : active.kind === "sos"
                  ? "SOS is on. Tap to manage."
                  : tripBanner(active)}
            </Text>
          </Pressable>
        )}
        {toast && <Text style={styles.banner}>{toast}</Text>}
        {legalAccepted !== undefined && legalAccepted !== LEGAL_VERSION && (
          // Never in the way of the map or SOS: a reminder until the person reads and agrees.
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setLegalDoc("privacy");
              openSheet("legal");
            }}
          >
            <Text style={styles.banner}>
              {legalAccepted
                ? "Our privacy notice has changed."
                : "Please read our privacy notice."}{" "}
              Tap to read.
            </Text>
          </Pressable>
        )}
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={styles.bottom} pointerEvents="box-none">
        {!selected && !selectedPresence && (
          <View style={styles.locateRow} pointerEvents="box-none">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show my location"
              onPress={() => void locateMe()}
              style={styles.roundButtonLarge}
            >
              <Icon name="crosshairs-gps" size={24} color={c.primary} />
            </Pressable>
          </View>
        )}
        {selectedPresence && (
          <View style={styles.cardWrap}>
            <PresenceCard presence={selectedPresence} />
          </View>
        )}
        {selected && (
          <View style={styles.cardWrap}>
            <IncidentCard
              key={selected.id}
              incident={selected}
              reacted={reactions[selected.id] ?? null}
              onReact={(kind) => react(selected.id, kind)}
              onClose={() => setSelectedId(null)}
              from={userPosition}
              language={settings.language}
            />
          </View>
        )}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t.sos}: alert my trusted contacts`}
            onPress={() => openSheet(active ? "session" : "sos")}
            style={({ pressed }) => [styles.sosButton, pressed && styles.pressed]}
          >
            <Text style={styles.sosText}>{t.sos}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.report}
            onPress={() => openSheet("report")}
            style={({ pressed }) => [styles.reportButton, pressed && styles.pressed]}
          >
            <Icon name="plus" size={24} color={c.onPrimary} />
            <Text style={styles.reportText}>{t.report}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share my trip"
            onPress={() => openSheet(active ? "session" : "trip")}
            style={styles.barButton}
          >
            <Icon name="map-marker-path" size={24} color={c.primary} />
            <Text style={styles.barLabel}>{t.trip}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Menu"
            onPress={() => openSheet("menu")}
            style={styles.barButton}
          >
            <Icon name="menu" size={24} color={c.primary} />
            <Text style={styles.barLabel}>{t.menu}</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <Modal visible={sheet !== null} animationType="slide" onRequestClose={() => setSheet(null)}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.modal}>
            {sheet === "report" && (
              <ReportFlow
                styleUrl={mapStyle}
                mapCenter={mapCenter}
                onClose={() => setSheet(null)}
                onSubmit={submit}
                onDiscard={(files) => void mediaQueue.discard(files.map((file) => file.uri))}
                language={settings.language}
              />
            )}
            {sheet === "mine" && (
              <MyReports outbox={outbox} source={source} onClose={() => setSheet(null)} />
            )}
            {sheet === "alerts" && (
              <AlertsScreen
                state={alertState}
                placeCount={places.length}
                onOpen={(entry) => {
                  void closeAlerts();
                  openAlert(entry);
                }}
                onSettings={() => setSheet("places")}
                onClose={() => void closeAlerts()}
                downloadAudio={(id) => source.broadcastAudio(id)}
              />
            )}
            {sheet === "places" && (
              <PlacesScreen
                styleUrl={mapStyle}
                mapCenter={mapCenter}
                onBack={() => setSheet("alerts")}
                onClose={() => setSheet(null)}
                onChanged={() => void placesChanged()}
              />
            )}
            {sheet === "menu" && (
              <View style={styles.flex}>
                <ModalHeader title={t.menu} onClose={() => setSheet(null)} />
                <ScrollView contentContainerStyle={styles.menu}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSheet("safety")}
                    style={[styles.readyCard, !readyForSos && styles.readyCardWarning]}
                  >
                    <Icon
                      name={readyForSos ? "shield-check" : "shield-alert"}
                      size={28}
                      color={readyForSos ? c.onPrimary : c.text}
                    />
                    <View style={styles.flex}>
                      <Text style={[styles.readyTitle, !readyForSos && styles.readyTitleWarning]}>
                        {readyForSos
                          ? profile?.personName
                            ? `${profile.personName}, you're ready for SOS`
                            : "You're ready for SOS"
                          : "SOS can't alert anyone yet"}
                      </Text>
                      <Text style={[styles.readyLine, !readyForSos && styles.readyLineWarning]}>
                        {readyForSos
                          ? [
                              `${contactNames.length} ${contactNames.length === 1 ? "contact" : "contacts"}`,
                              pinSet ? "PIN on" : "No PIN yet",
                              places.length > 0
                                ? `Alerts near ${places.map((p) => p.name).join(", ")}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : "Add a trusted contact so Warden can tell them."}
                      </Text>
                    </View>
                    <Icon name="chevron-right" color={readyForSos ? c.onPrimary : c.text} />
                  </Pressable>

                  <SectionLabel>Stay safe</SectionLabel>
                  <Card>
                    <ListRow
                      icon="map-marker-path"
                      title={t.shareMyTrip}
                      description="Live location while you travel"
                      onPress={() => setSheet(active ? "session" : "trip")}
                    />
                    <Divider inset={66} />
                    <ListRow
                      icon="account-heart"
                      title="Contacts and PIN"
                      description={
                        contactNames.length > 0
                          ? `${contactNames.join(", ")} · ${pinSet ? "PIN set" : "No PIN yet"}`
                          : "Who Warden tells in an emergency"
                      }
                      onPress={() => setSheet("safety")}
                    />
                    <Divider inset={66} />
                    <ListRow
                      icon="bell-outline"
                      title="Alerts and places"
                      description={
                        places.length > 0
                          ? places.map((place) => place.name).join(", ")
                          : "Add home, work or school"
                      }
                      badge={unread > 0 ? `${unread} new` : undefined}
                      onPress={() => setSheet("alerts")}
                    />
                  </Card>

                  <SectionLabel>Around you</SectionLabel>
                  <Card>
                    <ListRow
                      icon="account-group-outline"
                      tone="neutral"
                      title={t.community}
                      description="Checked tips from people nearby"
                      onPress={() => setSheet("community")}
                    />
                    <Divider inset={66} />
                    <ListRow
                      icon="chart-timeline-variant"
                      tone="neutral"
                      title="Area outlook"
                      description="What's been reported here in 3 months"
                      onPress={() => setSheet("outlook")}
                    />
                  </Card>

                  <SectionLabel>You</SectionLabel>
                  <Card>
                    <ListRow
                      icon="format-list-bulleted"
                      tone="neutral"
                      title="My reports"
                      description="Reports sent from this phone"
                      onPress={() => setSheet("mine")}
                    />
                    <Divider inset={66} />
                    <ListRow
                      icon="cog-outline"
                      tone="neutral"
                      title="Settings"
                      description="Language, night mode, demo mode"
                      onPress={() => setSheet("settings")}
                    />
                  </Card>
                  <EmergencyCallButton />
                </ScrollView>
              </View>
            )}
            {sheet === "safety" && <SafetyScreen onClose={() => setSheet(null)} />}
            {sheet === "trip" && (
              <TripScreen
                styleUrl={mapStyle}
                mapCenter={mapCenter}
                onStart={startTrip}
                onContacts={() => setSheet("safety")}
                onClose={() => setSheet(null)}
                findIncidents={findRouteIncidents}
                language={settings.language}
              />
            )}
            {sheet === "sos" && (
              <SosCountdown
                onSend={() => void sendSos()}
                onCancel={() => setSheet(null)}
                language={settings.language}
              />
            )}
            {sheet === "session" &&
              (active ? (
                <SessionScreen
                  session={active}
                  demo={active.feedId === "demo"}
                  language={settings.language}
                  onExtend={extend}
                  onFinish={finish}
                  onAnswerCheckIn={answerCheckIn}
                  findStops={findStops}
                  onClose={() => setSheet(null)}
                />
              ) : (
                <View style={styles.loading}>
                  <ActivityIndicator size="large" color={c.danger} />
                </View>
              ))}
            {sheet === "sosFailed" && (
              <View style={styles.flex}>
                <ModalHeader title={t.sos} onClose={() => setSheet(null)} />
                <View style={styles.menu}>
                  <Note tone="warning">
                    Warden could not be reached, so your contacts were not alerted. Call 112 or text
                    someone you trust.
                  </Note>
                  <EmergencyCallButton />
                  <Button
                    label="Try again"
                    variant="dangerOutline"
                    icon="alarm-light"
                    large
                    onPress={() => void sendSos()}
                  />
                </View>
              </View>
            )}
            {sheet === "community" && (
              <CommunityScreen
                source={source}
                around={mapCenter}
                language={settings.language}
                onClose={() => setSheet(null)}
              />
            )}
            {sheet === "outlook" && (
              <OutlookScreen
                source={source}
                bbox={bboxRef.current}
                onClose={() => setSheet(null)}
              />
            )}
            {sheet === "legal" && (
              <LegalScreen
                doc={legalDoc}
                onClose={() => setSheet(null)}
                onReadOther={() => setLegalDoc(legalDoc === "privacy" ? "terms" : "privacy")}
                onAccept={() => {
                  void acceptLegal(AsyncStorage, LEGAL_VERSION);
                  setLegalAccepted(LEGAL_VERSION);
                  setSheet(null);
                }}
              />
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

function KeyItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.keyItem}>
      <View
        style={[
          styles.keyDot,
          dashed
            ? { borderColor: color, borderWidth: 2, borderStyle: "dashed" }
            : { backgroundColor: color },
        ]}
      />
      <Text style={styles.keyText}>{label}</Text>
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

const makeStyles = (c: Palette) => {
  const floating = {
    shadowColor: c.shadow,
    shadowOpacity: c.name === "dark" ? 0.5 : 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  } as const;
  return StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: c.background },
    loading: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.background,
    },
    top: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: 12, gap: 10 },
    summary: {
      marginTop: 8,
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 20,
      backgroundColor: c.surface,
      borderWidth: c.name === "dark" ? 1 : 0,
      borderColor: c.border,
      ...floating,
    },
    summaryEyebrow: {
      fontSize: 12,
      fontWeight: "700",
      letterSpacing: 1,
      textTransform: "uppercase",
      color: c.muted,
    },
    summaryTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    levelDot: { width: 14, height: 14, borderRadius: 7 },
    summaryTitle: { flex: 1, fontSize: 21, lineHeight: 25, fontWeight: "800", color: c.text },
    summaryLine: { fontSize: 15, lineHeight: 20, color: c.muted },
    key: {
      flexDirection: "row",
      flexWrap: "wrap",
      columnGap: 12,
      rowGap: 4,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: c.divider,
    },
    keyItem: { flexDirection: "row", alignItems: "center", gap: 5 },
    keyDot: { width: 10, height: 10, borderRadius: 5 },
    keyText: { fontSize: 12.5, fontWeight: "700", color: c.muted },
    controls: { flexDirection: "row", alignItems: "center", gap: 8 },
    topButtons: { flexDirection: "row", gap: 8, marginLeft: "auto" },
    roundButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
      ...floating,
    },
    roundButtonLarge: {
      width: 50,
      height: 50,
      borderRadius: 25,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
      borderWidth: c.name === "dark" ? 1 : 0,
      borderColor: c.border,
      ...floating,
    },
    badge: {
      position: "absolute",
      top: -4,
      right: -4,
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      paddingHorizontal: 4,
      overflow: "hidden",
      backgroundColor: c.danger,
      color: c.onDanger,
      fontSize: 12,
      fontWeight: "700",
      fontFamily: MONO,
      textAlign: "center",
      lineHeight: 22,
      borderWidth: 2,
      borderColor: c.surface,
    },
    banner: {
      alignSelf: "flex-start",
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 10,
      overflow: "hidden",
      backgroundColor: c.noteWarningBg,
      borderWidth: 1,
      borderColor: c.noteWarningBorder,
      color: c.text,
      fontWeight: "700",
    },
    bottom: { position: "absolute", left: 0, right: 0, bottom: 0, gap: 10 },
    locateRow: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 14 },
    cardWrap: { paddingHorizontal: 10 },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 16,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      backgroundColor: c.surface,
      borderTopWidth: c.name === "dark" ? 1 : 0,
      borderColor: c.border,
      shadowColor: c.shadow,
      shadowOpacity: 0.12,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: -4 },
      elevation: 12,
    },
    sosButton: {
      width: 66,
      height: 66,
      borderRadius: 33,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.danger,
      borderWidth: 5,
      borderColor: c.dangerSoft,
    },
    sosText: { color: c.onDanger, fontWeight: "800", fontSize: 18, letterSpacing: 0.5 },
    reportButton: {
      flex: 1,
      minHeight: 56,
      borderRadius: 18,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: c.primary,
    },
    reportText: { color: c.onPrimary, fontSize: 18, fontWeight: "700" },
    barButton: { width: 56, minHeight: 60, alignItems: "center", justifyContent: "center", gap: 4 },
    barLabel: { fontSize: 12.5, fontWeight: "700", color: c.primary },
    pressed: { opacity: 0.8 },
    sessionBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      alignSelf: "flex-start",
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 22,
      backgroundColor: c.primary,
      ...floating,
    },
    sessionBannerSos: { backgroundColor: c.danger },
    sessionBannerText: { color: c.onPrimary, fontWeight: "800", fontSize: 15 },
    sessionBannerTextSos: { color: c.onDanger },
    modal: { flex: 1, backgroundColor: c.background },
    menu: { padding: 16, gap: 12, paddingBottom: 32 },
    readyCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      padding: 16,
      borderRadius: 20,
      backgroundColor: c.primary,
    },
    readyCardWarning: {
      backgroundColor: c.noteWarningBg,
      borderWidth: 1,
      borderColor: c.noteWarningBorder,
    },
    readyTitle: { fontSize: 17, fontWeight: "800", color: c.onPrimary },
    readyTitleWarning: { color: c.text },
    readyLine: { fontSize: 14, color: c.onPrimary, opacity: 0.9 },
    readyLineWarning: { color: c.text, opacity: 1 },
  });
};
