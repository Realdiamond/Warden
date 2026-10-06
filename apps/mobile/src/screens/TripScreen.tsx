import AsyncStorage from "@react-native-async-storage/async-storage";
import { MAX_SESSION_NOTE } from "@warden/shared";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, ModalHeader, Note } from "../components/ui.tsx";
import { loadProfile, type SafetyProfile } from "../lib/contacts.ts";
import { loadPlaces, type SavedPlace } from "../lib/places.ts";
import { COLORS } from "../lib/ui.ts";
import { PickLocation } from "./PickLocation.tsx";

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

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
}: {
  styleUrl: string;
  mapCenter: { lat: number; lng: number };
  onStart: (plan: TripPlan) => Promise<string | null>;
  onContacts: () => void;
  onClose: () => void;
}) {
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
        <ModalHeader
          title="Where are you going?"
          onClose={onClose}
          onBack={() => setPicking(false)}
        />
        <PickLocation
          styleUrl={styleUrl}
          start={destination ?? mapCenter}
          onPick={(point) => {
            setDestination({ ...point, label: "Place on the map" });
            setPicking(false);
          }}
        />
      </View>
    );
  }

  const noContacts = profile !== null && profile.contacts.length === 0;

  return (
    <View style={styles.screen}>
      <ModalHeader title="Share my trip" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>How long will it take?</Text>
        <View style={styles.chips}>
          {DURATIONS.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: minutes === value }}
              onPress={() => setMinutes(value)}
              style={[styles.chip, minutes === value && styles.chipActive]}
            >
              <Text style={[styles.chipText, minutes === value && styles.chipTextActive]}>
                {durationLabel(value)}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.help}>
          If you have not arrived 10 minutes after this, Warden texts your trusted contacts.
        </Text>

        <Text style={styles.section}>Where to? (optional)</Text>
        <View style={styles.chips}>
          {places.map((place) => {
            const selected = destination?.label === place.name;
            return (
              <Pressable
                key={place.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() =>
                  setDestination(
                    selected ? undefined : { lat: place.lat, lng: place.lng, label: place.name },
                  )
                }
                style={[styles.chip, selected && styles.chipActive]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                  {place.name}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            onPress={() => setPicking(true)}
            style={[styles.chip, destination?.label === "Place on the map" && styles.chipActive]}
          >
            <Text
              style={[
                styles.chipText,
                destination?.label === "Place on the map" && styles.chipTextActive,
              ]}
            >
              Pick on map
            </Text>
          </Pressable>
        </View>

        <Text style={styles.section}>Note for your contacts (optional)</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={note}
          onChangeText={(value) => setNote(value.slice(0, MAX_SESSION_NOTE))}
          placeholder="For example: Bolt, blue Corolla, plate KJA 123 XY"
          placeholderTextColor={COLORS.muted}
          multiline
          accessibilityLabel="Note for your contacts"
        />

        {noContacts && (
          <Note tone="warning">
            You have no trusted contacts yet. You can still share the link yourself, but Warden
            cannot text anyone if you are late.
          </Note>
        )}
        {noContacts && (
          <Button label="Add trusted contacts" icon="account-plus" onPress={onContacts} />
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        <Button
          label={busy ? "Starting..." : "Start sharing"}
          variant="primary"
          icon="map-marker-path"
          disabled={busy}
          onPress={() => {
            setBusy(true);
            setError(null);
            void onStart({ minutes, destination, note: note.trim() || undefined })
              .then(setError)
              .finally(() => setBusy(false));
          }}
        />
        <Note>
          While sharing, Android shows a Warden notification. Your location goes only to people with
          your private link and is deleted two days after the trip ends.
        </Note>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 16, gap: 12, paddingBottom: 48 },
  section: { fontSize: 18, fontWeight: "700", color: COLORS.text, marginTop: 8 },
  help: { color: COLORS.muted },
  error: { color: COLORS.danger, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
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
  multiline: { minHeight: 80, paddingTop: 12, textAlignVertical: "top" },
});
