// Report in under 30 seconds: pick a type, confirm the place, optionally add words, send.
// Reports are anonymous; the phone's own position is used only to place the pin and to work
// out a distance band, and is never sent.

import {
  CATEGORY_GROUPS,
  type Category,
  type CategoryGroup,
  categoriesInGroup,
  MAX_DESCRIPTION_LENGTH,
  type ProximityBand,
  proximityBand,
  type ReportSubmission,
} from "@warden/shared";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button, EmergencyCallButton, Icon, ModalHeader, Note } from "../components/ui.tsx";
import { currentPosition, type Position } from "../lib/location.ts";
import { COLORS, GROUP_ICONS } from "../lib/ui.ts";
import { PickLocation } from "./PickLocation.tsx";

type Step = "group" | "category" | "location" | "pick" | "details" | "sending" | "done";

export interface SendOutcome {
  message: string;
  tone: "success" | "queued" | "error";
}

interface Props {
  styleUrl: string;
  /** Where the main map was looking; the starting point when the phone's location is unknown. */
  mapCenter: { lat: number; lng: number };
  onClose: () => void;
  onSubmit: (body: ReportSubmission) => Promise<SendOutcome>;
}

export function ReportFlow({ styleUrl, mapCenter, onClose, onSubmit }: Props) {
  const [step, setStep] = useState<Step>("group");
  const [group, setGroup] = useState<CategoryGroup | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [place, setPlace] = useState<Position | null>(null);
  const [proximity, setProximity] = useState<ProximityBand>("unknown");
  const [devicePosition, setDevicePosition] = useState<Position | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);

  async function takeCurrentLocation() {
    setLocating(true);
    setLocationError(null);
    const position = await currentPosition();
    setLocating(false);
    if (!position) {
      setLocationError("We could not get your location. Choose the place on the map instead.");
      return;
    }
    setDevicePosition(position);
    setPlace(position);
    setProximity("here");
    setStep("details");
  }

  async function chooseOnMap() {
    // A quick fix helps centre the map and lets us work out the distance band.
    setLocating(true);
    const position = devicePosition ?? (await currentPosition(5_000));
    setLocating(false);
    if (position) setDevicePosition(position);
    setStep("pick");
  }

  async function send() {
    if (!category || !place) return;
    setStep("sending");
    const body: ReportSubmission = {
      categoryId: category.id as ReportSubmission["categoryId"],
      location: {
        lat: place.lat,
        lng: place.lng,
        ...(place.accuracyM !== undefined ? { accuracyM: Math.min(place.accuracyM, 50_000) } : {}),
      },
      proximity,
      ...(description.trim() ? { description: description.trim() } : {}),
    };
    setOutcome(await onSubmit(body));
    setStep("done");
  }

  const back = () => {
    if (step === "category") setStep("group");
    else if (step === "location") setStep("category");
    else if (step === "pick" || step === "details") setStep("location");
  };
  const canGoBack =
    step === "category" || step === "location" || step === "pick" || step === "details";

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="height">
      <ModalHeader title="Report" onClose={onClose} onBack={canGoBack ? back : undefined} />

      {step === "pick" ? (
        <PickLocation
          styleUrl={styleUrl}
          start={devicePosition ?? mapCenter}
          onPick={(point) => {
            setPlace(point);
            setProximity(proximityBand(devicePosition, point));
            setStep("details");
          }}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {step === "group" && (
            <>
              <EmergencyCallButton />
              <Text style={styles.question}>What is happening?</Text>
              <View style={styles.grid}>
                {CATEGORY_GROUPS.map((item) => (
                  <Tile
                    key={item.id}
                    label={item.label}
                    icon={GROUP_ICONS[item.id]}
                    onPress={() => {
                      setGroup(item);
                      setStep("category");
                    }}
                  />
                ))}
              </View>
              <Note>Reports are anonymous. Warden does not ask for your name.</Note>
            </>
          )}

          {step === "category" && group && (
            <>
              <Text style={styles.question}>{group.label}: which one?</Text>
              <View style={styles.list}>
                {categoriesInGroup(group.id).map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    style={({ pressed }) => [styles.listItem, pressed && styles.pressed]}
                    onPress={() => {
                      setCategory(item);
                      setStep("location");
                    }}
                  >
                    <Icon name={item.icon} />
                    <Text style={styles.listText}>{item.label}</Text>
                    <Icon name="chevron-right" color={COLORS.muted} />
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {step === "location" && (
            <>
              <Text style={styles.question}>Where did it happen?</Text>
              {locating ? (
                <ActivityIndicator size="large" color={COLORS.primary} />
              ) : (
                <View style={styles.list}>
                  <Button
                    label="Where I am now"
                    icon="crosshairs-gps"
                    variant="primary"
                    onPress={() => void takeCurrentLocation()}
                  />
                  <Button
                    label="Choose on the map"
                    icon="map-marker-radius"
                    onPress={() => void chooseOnMap()}
                  />
                </View>
              )}
              {locationError && <Note tone="warning">{locationError}</Note>}
              <Note>Your own location stays on this phone. Only the place you report is sent.</Note>
            </>
          )}

          {step === "details" && category && (
            <>
              <Text style={styles.question}>{category.label}</Text>
              {category.handling === "private" ? (
                <Note tone="warning">
                  This report goes only to trained staff. It will never appear on the map.
                </Note>
              ) : null}
              <Text style={styles.fieldLabel}>Anything else? (optional)</Text>
              <TextInput
                style={styles.input}
                multiline
                maxLength={MAX_DESCRIPTION_LENGTH}
                value={description}
                onChangeText={setDescription}
                placeholder="What did you see? For example: two men on a red motorcycle."
                placeholderTextColor={COLORS.muted}
                accessibilityLabel="Description"
              />
              <Text style={styles.counter}>
                {description.length}/{MAX_DESCRIPTION_LENGTH}
              </Text>
              <Note>
                Please do not include names, phone numbers, or anyone's ethnicity or religion.
              </Note>
              <Button
                label="Send report"
                variant="primary"
                icon="check-circle"
                onPress={() => void send()}
              />
            </>
          )}

          {step === "sending" && <ActivityIndicator size="large" color={COLORS.primary} />}

          {step === "done" && outcome && (
            <>
              <View style={styles.doneIcon}>
                <Icon
                  name={
                    outcome.tone === "error"
                      ? "alert-circle"
                      : outcome.tone === "queued"
                        ? "clock-outline"
                        : "check-circle"
                  }
                  size={56}
                  color={outcome.tone === "error" ? COLORS.danger : COLORS.primary}
                />
              </View>
              <Text style={styles.doneText}>{outcome.message}</Text>
              <Button label="Back to the map" variant="primary" onPress={onClose} />
              <EmergencyCallButton />
            </>
          )}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

function Tile({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <Icon name={icon} size={30} color={COLORS.primary} />
      <Text style={styles.tileText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  body: { padding: 16, gap: 14 },
  question: { fontSize: 22, fontWeight: "700", color: COLORS.text },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: {
    width: "47%",
    minHeight: 104,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    gap: 8,
  },
  tileText: { fontSize: 15, fontWeight: "600", color: COLORS.text, textAlign: "center" },
  list: { gap: 10 },
  listItem: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  listText: { flex: 1, fontSize: 16, color: COLORS.text },
  pressed: { opacity: 0.7 },
  fieldLabel: { fontSize: 15, fontWeight: "600", color: COLORS.text },
  input: {
    minHeight: 110,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.surface,
  },
  counter: { alignSelf: "flex-end", color: COLORS.muted, fontSize: 12 },
  doneIcon: { alignItems: "center", marginTop: 24 },
  doneText: { fontSize: 18, textAlign: "center", color: COLORS.text, marginBottom: 8 },
});
