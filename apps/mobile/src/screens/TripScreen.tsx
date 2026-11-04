import AsyncStorage from "@react-native-async-storage/async-storage";
import { type BBox, MAX_SESSION_NOTE, type PublicIncident } from "@warden/shared";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { RouteSafety } from "../components/RouteSafety.tsx";
import { Text, TextInput } from "../components/text.tsx";
import { useStyles } from "../components/theme.tsx";
import { Button, Chip, ModalHeader, Note } from "../components/ui.tsx";
import { loadProfile, type SafetyProfile } from "../lib/contacts.ts";
import { type Language, strings } from "../lib/i18n.ts";
import { loadPlaces, PLACE_ICONS, type SavedPlace } from "../lib/places.ts";
import type { Palette } from "../lib/theme.ts";
import { PickLocation } from "./PickLocation.tsx";

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

/** Stored as the destination label when the person picks a point on the map. */
const PLACE_ON_MAP = "Place on the map";

export interface TripPlan {
  minutes: number;
  destination?: { lat: number; lng: number; label?: string };
  note?: string;
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${Math.floor(hours)} h ${minutes % 60}`;
}

export function TripScreen({
  styleUrl,
  mapCenter,
  onStart,
  onContacts,
  onClose,
  findIncidents,
  language,
}: {
  styleUrl: string;
  mapCenter: { lat: number; lng: number };
  /** Public map incidents for the route score. */
  findIncidents: (bbox: BBox) => Promise<PublicIncident[]>;
  language: Language;
  onStart: (plan: TripPlan) => Promise<string | null>;
  onContacts: () => void;
  onClose: () => void;
}) {
  const t = strings(language);
  const styles = useStyles(makeStyles);
  const [profile, setProfile] = useState<SafetyProfile | null>(null);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [minutes, setMinutes] = useState(30);
  const [destination, setDestination] = useState<TripPlan["destination"]>();
  const [note, setNote] = useState("");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setProfile(await loadProfile(AsyncStorage));
      setPlaces(await loadPlaces(AsyncStorage));
    })();
  }, []);

  if (picking) {
    return (
      <View style={styles.screen}>
        <ModalHeader title={t.whereGoing} onClose={onClose} onBack={() => setPicking(false)} />
        <PickLocation
          styleUrl={styleUrl}
          start={destination ?? mapCenter}
          hint={t.moveToDestination}
          onPick={(point) => {
            setDestination({ ...point, label: PLACE_ON_MAP });
            setPicking(false);
          }}
        />
      </View>
    );
  }

  const noContacts = profile !== null && profile.contacts.length === 0;

  return (
    <View style={styles.screen}>
      <ModalHeader title={t.shareMyTrip} onClose={onClose} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {t.howLong}
          </Text>
          <View style={styles.chips}>
            {DURATIONS.map((value) => (
              <Chip
                key={value}
                label={durationLabel(value)}
                selected={minutes === value}
                onPress={() => setMinutes(value)}
              />
            ))}
          </View>
          <Text style={styles.help}>{t.lateHelp}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {t.whereTo}
          </Text>
          <View style={styles.chips}>
            {places.map((place) => {
              const selected = destination?.label === place.name;
              return (
                <Chip
                  key={place.id}
                  label={place.name}
                  icon={PLACE_ICONS[place.kind]}
                  selected={selected}
                  onPress={() =>
                    setDestination(
                      selected ? undefined : { lat: place.lat, lng: place.lng, label: place.name },
                    )
                  }
                />
              );
            })}
            <Chip
              label={t.pickOnMap}
              icon="map-marker-radius"
              selected={destination?.label === PLACE_ON_MAP}
              onPress={() => setPicking(true)}
            />
          </View>
        </View>

        {destination && (
          <RouteSafety
            destination={destination}
            findIncidents={findIncidents}
            language={language}
          />
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {t.noteForContacts}
          </Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={(value) => setNote(value.slice(0, MAX_SESSION_NOTE))}
            placeholder={t.notePlaceholder}
            multiline
            accessibilityLabel="Note for your contacts"
          />
        </View>

        {noContacts && <Note tone="warning">{t.noContactsTrip}</Note>}
        {noContacts && <Button label={t.addContacts} icon="account-plus" onPress={onContacts} />}
        {error && <Text style={styles.error}>{error}</Text>}
        <Button
          label={busy ? t.starting : t.startSharing}
          variant="primary"
          icon="map-marker-path"
          large
          disabled={busy}
          onPress={() => {
            setBusy(true);
            setError(null);
            void onStart({ minutes, destination, note: note.trim() || undefined })
              .then(setError)
              .finally(() => setBusy(false));
          }}
        />
        <Note icon="shield-lock-outline">{t.tripPrivacy}</Note>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 48, gap: 18 },
    section: { gap: 10 },
    sectionTitle: { fontSize: 19, fontWeight: "800", color: c.text },
    help: { fontSize: 14.5, lineHeight: 20, color: c.muted },
    error: { color: c.dangerText, fontWeight: "700", fontSize: 15 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    input: {
      minHeight: 88,
      borderWidth: 1,
      borderColor: c.borderStrong,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 12,
      fontSize: 17,
      lineHeight: 23,
      textAlignVertical: "top",
      backgroundColor: c.surface,
    },
  });
