import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { ensureBackgroundChecks } from "../background.ts";
import { Text, TextInput } from "../components/text.tsx";
import { useStyles, useTheme } from "../components/theme.tsx";
import {
  Button,
  Card,
  Chip,
  Divider,
  Icon,
  IconTile,
  ModalHeader,
  Note,
  SectionLabel,
  SwitchRow,
} from "../components/ui.tsx";
import {
  type AlertPrefs,
  DEFAULT_ALERT_PREFS,
  loadAlertPrefs,
  saveAlertPrefs,
} from "../lib/alerts.ts";
import { currentPosition } from "../lib/location.ts";
import { requestNotificationPermission, showNotifications } from "../lib/notify.ts";
import {
  clearLastArea,
  loadPlaces,
  MAX_PLACE_NAME,
  MAX_PLACES,
  PLACE_ICONS,
  PLACE_KIND_LABEL,
  PLACE_KINDS,
  type PlaceKind,
  type SavedPlace,
  saveLastArea,
  savePlaces,
} from "../lib/places.ts";
import type { Palette } from "../lib/theme.ts";
import { PickLocation } from "./PickLocation.tsx";

const START_HOURS = [20, 21, 22, 23];
const END_HOURS = [5, 6, 7];

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${suffix}`;
}

interface Draft {
  kind: PlaceKind;
  name: string;
  point: { lat: number; lng: number } | null;
}

export function PlacesScreen({
  styleUrl,
  mapCenter,
  onBack,
  onClose,
  onChanged,
}: {
  styleUrl: string;
  mapCenter: { lat: number; lng: number };
  onBack: () => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [places, setPlaces] = useState<SavedPlace[] | null>(null);
  const [prefs, setPrefs] = useState<AlertPrefs>(DEFAULT_ALERT_PREFS);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [backgroundOk, setBackgroundOk] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      setPlaces(await loadPlaces(AsyncStorage));
      const loaded = await loadAlertPrefs(AsyncStorage);
      setPrefs(loaded);
      setBackgroundOk(await ensureBackgroundChecks().catch(() => false));
    })();
  }, []);

  const updatePrefs = useCallback(
    async (next: AlertPrefs) => {
      if (next.enabled && !prefs.enabled) {
        const allowed = await requestNotificationPermission();
        if (!allowed) {
          setMessage(
            "Notifications are blocked for Warden. Allow them in your phone's settings to get alerts.",
          );
        }
      }
      if (!next.aroundMe && prefs.aroundMe) await clearLastArea(AsyncStorage);
      setPrefs(next);
      await saveAlertPrefs(AsyncStorage, next);
      setBackgroundOk(await ensureBackgroundChecks().catch(() => false));
      onChanged();
    },
    [prefs, onChanged],
  );

  const storePlaces = useCallback(
    async (next: SavedPlace[]) => {
      setPlaces(next);
      await savePlaces(AsyncStorage, next);
      onChanged();
    },
    [onChanged],
  );

  const locateHere = useCallback(async () => {
    setLocating(true);
    const position = await currentPosition(15_000);
    setLocating(false);
    if (!position) {
      setMessage("Could not get your location. Pick the place on the map instead.");
      return;
    }
    setDraft((d) => (d ? { ...d, point: { lat: position.lat, lng: position.lng } } : d));
  }, []);

  const saveDraft = useCallback(async () => {
    if (!draft?.point || !places) return;
    const name = draft.name.trim() || PLACE_KIND_LABEL[draft.kind];
    await storePlaces([
      ...places,
      { id: randomUUID(), kind: draft.kind, name, lat: draft.point.lat, lng: draft.point.lng },
    ]);
    setDraft(null);
    if (places.length === 0 && !prefs.enabled) await updatePrefs({ ...prefs, enabled: true });
    else if (places.length === 0) await requestNotificationPermission();
  }, [draft, places, prefs, storePlaces, updatePrefs]);

  const sendTest = useCallback(async () => {
    const allowed = await requestNotificationPermission();
    if (!allowed) {
      setMessage("Notifications are blocked for Warden in your phone's settings.");
      return;
    }
    await showNotifications([
      {
        alertId: `test_${Date.now()}`,
        incidentId: null,
        channel: "warning",
        title: "Test alert",
        body: "This is how Warden alerts look. Nothing has happened.",
        speech: null,
      },
    ]);
  }, []);

  if (picking && draft) {
    return (
      <View style={styles.screen}>
        <ModalHeader title="Pick the place" onClose={onClose} onBack={() => setPicking(false)} />
        <PickLocation
          styleUrl={styleUrl}
          start={draft.point ?? mapCenter}
          onPick={(point) => {
            setDraft({ ...draft, point });
            setPicking(false);
          }}
        />
      </View>
    );
  }

  if (!places) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ModalHeader title="Places and alerts" onClose={onClose} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {message && <Note tone="warning">{message}</Note>}

        <View style={styles.section}>
          <SectionLabel>Your places</SectionLabel>
          {places.length > 0 && (
            <Card>
              {places.map((place, index) => (
                <View key={place.id}>
                  {index > 0 && <Divider inset={68} />}
                  <View style={styles.placeRow}>
                    <IconTile icon={PLACE_ICONS[place.kind]} tone="primary" size={40} />
                    <Text style={styles.placeName}>{place.name}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${place.name}`}
                      onPress={() => void storePlaces(places.filter((p) => p.id !== place.id))}
                      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                    >
                      <Icon name="trash-can-outline" color={c.muted} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </Card>
          )}

          {draft ? (
            <Card style={styles.draft}>
              <Text style={styles.label}>What is this place?</Text>
              <View style={styles.chips}>
                {PLACE_KINDS.map((kind) => (
                  <Chip
                    key={kind}
                    label={PLACE_KIND_LABEL[kind]}
                    icon={PLACE_ICONS[kind]}
                    selected={draft.kind === kind}
                    onPress={() => setDraft({ ...draft, kind })}
                  />
                ))}
              </View>
              <TextInput
                style={styles.input}
                value={draft.name}
                onChangeText={(name) => setDraft({ ...draft, name: name.slice(0, MAX_PLACE_NAME) })}
                placeholder={`Name (for example "${PLACE_KIND_LABEL[draft.kind]}")`}
                accessibilityLabel="Place name"
              />
              {draft.point ? (
                <View style={styles.located}>
                  <Icon name="check-circle" size={20} color={c.primary} />
                  <Text style={styles.locatedText}>Location set. You can change it below.</Text>
                </View>
              ) : (
                <Text style={styles.help}>Where is it?</Text>
              )}
              <View style={styles.buttonRow}>
                <View style={styles.flex}>
                  <Button
                    label={locating ? "Finding you..." : "Where I am now"}
                    icon="crosshairs-gps"
                    disabled={locating}
                    onPress={() => void locateHere()}
                  />
                </View>
                <View style={styles.flex}>
                  <Button label="Pick on map" icon="map" onPress={() => setPicking(true)} />
                </View>
              </View>
              <Button
                label="Save place"
                variant="primary"
                icon="check"
                large
                disabled={!draft.point}
                onPress={() => void saveDraft()}
              />
              <Button label="Cancel" variant="text" onPress={() => setDraft(null)} />
            </Card>
          ) : places.length < MAX_PLACES ? (
            <Button
              label="Add a place"
              icon="plus"
              variant={places.length === 0 ? "primary" : "secondary"}
              onPress={() =>
                setDraft({ kind: places.length === 0 ? "home" : "work", name: "", point: null })
              }
            />
          ) : (
            <Text style={styles.help}>You can save up to {MAX_PLACES} places.</Text>
          )}

          <Note icon="cellphone-lock">
            Your places stay on this phone. Warden asks the server for alerts across wide areas
            (about 11 km squares) and checks here which are near you.
          </Note>
        </View>

        <View style={styles.section}>
          <SectionLabel>Alerts</SectionLabel>
          <Card>
            <SwitchRow
              title="Alerts near my places"
              description="Critical alerts, like kidnapping or shooting, are always included."
              value={prefs.enabled}
              onValueChange={(enabled) => void updatePrefs({ ...prefs, enabled })}
            />
            <Divider />
            <Dimmed off={!prefs.enabled}>
              <SwitchRow
                title="Warnings"
                description="Serious incidents such as robberies."
                value={prefs.tiers.warning}
                disabled={!prefs.enabled}
                onValueChange={(warning) =>
                  void updatePrefs({ ...prefs, tiers: { ...prefs.tiers, warning } })
                }
              />
              <Divider />
              <SwitchRow
                title="Advisories"
                description="Less serious incidents such as theft or road blockages."
                value={prefs.tiers.advisory}
                disabled={!prefs.enabled}
                onValueChange={(advisory) =>
                  void updatePrefs({ ...prefs, tiers: { ...prefs.tiers, advisory } })
                }
              />
              <Divider />
              <SwitchRow
                title="Also where I last was"
                description="Uses the place your phone was when you last used your location in Warden."
                value={prefs.aroundMe}
                disabled={!prefs.enabled}
                onValueChange={(aroundMe) => {
                  void updatePrefs({ ...prefs, aroundMe });
                  if (aroundMe) {
                    void currentPosition(15_000).then((p) =>
                      p ? saveLastArea(AsyncStorage, p, new Date()).then(onChanged) : undefined,
                    );
                  }
                }}
              />
              <Divider />
              <SwitchRow
                title="Read alerts aloud"
                description="Speaks new alerts while Warden is open, for example when driving."
                value={prefs.speak}
                disabled={!prefs.enabled}
                onValueChange={(speak) => void updatePrefs({ ...prefs, speak })}
              />
              <Divider />
              <SwitchRow
                title="Quiet hours"
                description="No sound at night, except for critical alerts."
                value={prefs.quietHours.enabled}
                disabled={!prefs.enabled}
                onValueChange={(enabled) =>
                  void updatePrefs({ ...prefs, quietHours: { ...prefs.quietHours, enabled } })
                }
              />
              {prefs.enabled && prefs.quietHours.enabled && (
                <View style={styles.hours}>
                  <Text style={styles.label}>From</Text>
                  <HourChips
                    hours={START_HOURS}
                    value={prefs.quietHours.startHour}
                    onChange={(startHour) =>
                      void updatePrefs({ ...prefs, quietHours: { ...prefs.quietHours, startHour } })
                    }
                  />
                  <Text style={styles.label}>Until</Text>
                  <HourChips
                    hours={END_HOURS}
                    value={prefs.quietHours.endHour}
                    onChange={(endHour) =>
                      void updatePrefs({ ...prefs, quietHours: { ...prefs.quietHours, endHour } })
                    }
                  />
                </View>
              )}
            </Dimmed>
          </Card>
        </View>

        {prefs.enabled && backgroundOk === false && (
          <Note tone="warning">
            Your phone is not letting Warden check for alerts in the background. You will get alerts
            when you open the app. Turning off battery saving for Warden can help.
          </Note>
        )}

        <Button label="Send a test alert" icon="bell-ring" onPress={() => void sendTest()} />
        <Note>
          Alerts can arrive late when your phone is saving battery or has no data. In danger now?
          Call 112.
        </Note>
      </ScrollView>
    </View>
  );
}

/** Settings that only matter while alerts are on. */
function Dimmed({ off, children }: { off: boolean; children: ReactNode }) {
  return <View style={off ? { opacity: 0.5 } : undefined}>{children}</View>;
}

function HourChips({
  hours,
  value,
  onChange,
}: {
  hours: number[];
  value: number;
  onChange: (hour: number) => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.chips}>
      {hours.map((hour) => (
        <Chip
          key={hour}
          label={hourLabel(hour)}
          selected={value === hour}
          onPress={() => onChange(hour)}
        />
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    center: { alignItems: "center", justifyContent: "center" },
    body: { padding: 16, gap: 18, paddingBottom: 48 },
    section: { gap: 10 },
    placeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 60,
      paddingLeft: 14,
      paddingRight: 4,
    },
    placeName: { flex: 1, fontSize: 16, fontWeight: "700", color: c.text },
    iconButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
    pressed: { opacity: 0.6 },
    draft: { gap: 12, padding: 16 },
    label: { fontSize: 16, fontWeight: "700", color: c.text },
    help: { color: c.muted, fontSize: 14, lineHeight: 20 },
    located: { flexDirection: "row", alignItems: "center", gap: 8 },
    locatedText: { flex: 1, color: c.text, fontSize: 15 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    input: {
      minHeight: 52,
      borderWidth: 1,
      borderColor: c.borderStrong,
      borderRadius: 14,
      paddingHorizontal: 16,
      fontSize: 17,
      color: c.text,
      backgroundColor: c.surface,
    },
    buttonRow: { flexDirection: "row", gap: 8 },
    flex: { flex: 1 },
    hours: { gap: 10, paddingHorizontal: 16, paddingBottom: 16 },
  });
