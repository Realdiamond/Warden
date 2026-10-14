import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { ensureBackgroundChecks } from "../background.ts";
import { Button, Icon, ModalHeader, Note } from "../components/ui.tsx";
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
import { COLORS } from "../lib/ui.ts";
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
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ModalHeader title="Places and alerts" onClose={onClose} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {message && <Note tone="warning">{message}</Note>}

        <Text style={styles.section}>Your places</Text>
        {places.map((place) => (
          <View key={place.id} style={styles.placeRow}>
            <Icon name={PLACE_ICONS[place.kind]} color={COLORS.primary} />
            <Text style={styles.placeName}>{place.name}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${place.name}`}
              onPress={() => void storePlaces(places.filter((p) => p.id !== place.id))}
              style={styles.iconButton}
            >
              <Icon name="trash-can-outline" color={COLORS.muted} />
            </Pressable>
          </View>
        ))}

        {draft ? (
          <View style={styles.card}>
            <Text style={styles.label}>What is this place?</Text>
            <View style={styles.chips}>
              {PLACE_KINDS.map((kind) => (
                <Pressable
                  key={kind}
                  accessibilityRole="button"
                  accessibilityState={{ selected: draft.kind === kind }}
                  onPress={() => setDraft({ ...draft, kind })}
                  style={[styles.chip, draft.kind === kind && styles.chipActive]}
                >
                  <Text style={[styles.chipText, draft.kind === kind && styles.chipTextActive]}>
                    {PLACE_KIND_LABEL[kind]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={draft.name}
              onChangeText={(name) => setDraft({ ...draft, name: name.slice(0, MAX_PLACE_NAME) })}
              placeholder={`Name (for example "${PLACE_KIND_LABEL[draft.kind]}")`}
              placeholderTextColor={COLORS.muted}
              accessibilityLabel="Place name"
            />
            {draft.point ? (
              <Text style={styles.help}>Location set. You can change it below.</Text>
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
              disabled={!draft.point}
              onPress={() => void saveDraft()}
            />
            <Button label="Cancel" onPress={() => setDraft(null)} />
          </View>
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

        <Note>
          Your places stay on this phone. Warden asks the server for alerts across wide areas (about
          11 km squares) and checks here which are near you.
        </Note>

        <Text style={styles.section}>Alerts</Text>
        <ToggleRow
          label="Alerts near my places"
          help="Critical alerts, like kidnapping or shooting, are always included."
          value={prefs.enabled}
          onChange={(enabled) => void updatePrefs({ ...prefs, enabled })}
        />
        <ToggleRow
          label="Warnings"
          help="Serious incidents such as robberies."
          value={prefs.tiers.warning}
          disabled={!prefs.enabled}
          onChange={(warning) => void updatePrefs({ ...prefs, tiers: { ...prefs.tiers, warning } })}
        />
        <ToggleRow
          label="Advisories"
          help="Less serious incidents such as theft or road blockages."
          value={prefs.tiers.advisory}
          disabled={!prefs.enabled}
          onChange={(advisory) =>
            void updatePrefs({ ...prefs, tiers: { ...prefs.tiers, advisory } })
          }
        />
        <ToggleRow
          label="Also where I last was"
          help="Uses the place your phone was when you last used your location in Warden."
          value={prefs.aroundMe}
          disabled={!prefs.enabled}
          onChange={(aroundMe) => {
            void updatePrefs({ ...prefs, aroundMe });
            if (aroundMe) {
              void currentPosition(15_000).then((p) =>
                p ? saveLastArea(AsyncStorage, p, new Date()).then(onChanged) : undefined,
              );
            }
          }}
        />
        <ToggleRow
          label="Read alerts aloud"
          help="Speaks new alerts while Warden is open, for example when driving."
          value={prefs.speak}
          disabled={!prefs.enabled}
          onChange={(speak) => void updatePrefs({ ...prefs, speak })}
        />
        <ToggleRow
          label="Quiet hours"
          help="No sound at night, except for critical alerts."
          value={prefs.quietHours.enabled}
          disabled={!prefs.enabled}
          onChange={(enabled) =>
            void updatePrefs({ ...prefs, quietHours: { ...prefs.quietHours, enabled } })
          }
        />
        {prefs.enabled && prefs.quietHours.enabled && (
          <View style={styles.card}>
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

function ToggleRow({
  label,
  help,
  value,
  disabled,
  onChange,
}: {
  label: string;
  help: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={[styles.toggleRow, disabled && styles.disabled]}>
      <View style={styles.flex}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.help}>{help}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: COLORS.primary }}
      />
    </View>
  );
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
  return (
    <View style={styles.chips}>
      {hours.map((hour) => (
        <Pressable
          key={hour}
          accessibilityRole="button"
          accessibilityState={{ selected: value === hour }}
          onPress={() => onChange(hour)}
          style={[styles.chip, value === hour && styles.chipActive]}
        >
          <Text style={[styles.chipText, value === hour && styles.chipTextActive]}>
            {hourLabel(hour)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  body: { padding: 16, gap: 12, paddingBottom: 48 },
  section: { fontSize: 20, fontWeight: "700", color: COLORS.text, marginTop: 8 },
  placeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: 12,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  placeName: { flex: 1, fontSize: 16, color: COLORS.text },
  iconButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  card: {
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  label: { fontSize: 16, fontWeight: "600", color: COLORS.text },
  help: { color: COLORS.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.text, fontWeight: "600" },
  chipTextActive: { color: COLORS.primaryText },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.surface,
  },
  buttonRow: { flexDirection: "row", gap: 8 },
  flex: { flex: 1 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  disabled: { opacity: 0.5 },
});
