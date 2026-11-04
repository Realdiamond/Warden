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
  supportFor,
} from "@warden/shared";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { AttachmentPicker } from "../components/AttachmentPicker.tsx";
import { Text, TextInput } from "../components/text.tsx";
import { useStyles, useTheme } from "../components/theme.tsx";
import {
  Button,
  Card,
  Divider,
  EmergencyCallButton,
  Icon,
  IconTile,
  ListRow,
  ModalHeader,
  Note,
  type Tone,
} from "../components/ui.tsx";
import { categoryName, type Language, strings } from "../lib/i18n.ts";
import { currentPosition, type Position } from "../lib/location.ts";
import type { Attachment } from "../lib/media.ts";
import { MONO, type Palette } from "../lib/theme.ts";
import { GROUP_ICONS, GROUP_LABELS, GROUP_TONES } from "../lib/ui.ts";
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
  onSubmit: (body: ReportSubmission, attachments: Attachment[]) => Promise<SendOutcome>;
  /** Removes files the person added but did not send. */
  onDiscard?: (attachments: Attachment[]) => void;
  language: Language;
}

/** Three steps for the person: what, where, details. */
const STEP_NUMBER: Partial<Record<Step, number>> = {
  group: 1,
  category: 1,
  location: 2,
  pick: 2,
  details: 3,
};

export function ReportFlow({ styleUrl, mapCenter, onClose, onSubmit, onDiscard, language }: Props) {
  const t = strings(language);
  const c = useTheme();
  const styles = useStyles(makeStyles);
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  async function takeCurrentLocation() {
    setLocating(true);
    setLocationError(null);
    const position = await currentPosition();
    setLocating(false);
    if (!position) {
      setLocationError(t.noLocation);
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
    const files = attachments;
    setAttachments([]);
    setOutcome(await onSubmit(body, files));
    setStep("done");
  }

  const back = () => {
    if (step === "category") setStep("group");
    else if (step === "location") setStep("category");
    else if (step === "pick" || step === "details") setStep("location");
  };
  const canGoBack =
    step === "category" || step === "location" || step === "pick" || step === "details";
  const stepNumber = STEP_NUMBER[step];
  const publicGroups = CATEGORY_GROUPS.filter((item) => item.id !== "personal");
  const personalGroup = CATEGORY_GROUPS.find((item) => item.id === "personal");
  const pickGroup = (item: CategoryGroup) => {
    setGroup(item);
    setStep("category");
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="height">
      <ModalHeader
        title={t.report}
        onClose={() => {
          if (attachments.length > 0) onDiscard?.(attachments);
          onClose();
        }}
        onBack={canGoBack ? back : undefined}
      />

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
          {stepNumber !== undefined && (
            <Text style={styles.stepLabel}>{t.stepOf(stepNumber, 3)}</Text>
          )}

          {step === "group" && (
            <>
              <Text style={styles.question} accessibilityRole="header">
                {t.whatsHappening}
              </Text>
              <EmergencyCallButton tone="soft" label={t.call112First} />
              <View style={styles.grid}>
                {publicGroups.map((item) => (
                  <Tile
                    key={item.id}
                    label={GROUP_LABELS[item.id]}
                    icon={GROUP_ICONS[item.id]}
                    tone={GROUP_TONES[item.id]}
                    onPress={() => pickGroup(item)}
                  />
                ))}
              </View>
              {personalGroup && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${GROUP_LABELS.personal}. ${t.privateGroupNote}`}
                  onPress={() => pickGroup(personalGroup)}
                  style={({ pressed }) => [styles.privateTile, pressed && styles.pressed]}
                >
                  <IconTile icon="lock-outline" tone="primary" size={44} />
                  <View style={styles.privateText}>
                    <Text style={styles.privateTitle}>{GROUP_LABELS.personal}</Text>
                    <Text style={styles.privateNote}>{t.privateGroupNote}</Text>
                  </View>
                  <Icon name="chevron-right" color={c.primary} />
                </Pressable>
              )}
              <View style={styles.footerLine}>
                <Icon name="eye-off-outline" size={20} color={c.muted} />
                <Text style={styles.footerText}>{t.anonymousNoName}</Text>
              </View>
            </>
          )}

          {step === "category" && group && (
            <>
              <Text style={styles.question} accessibilityRole="header">
                {t.whichOne(GROUP_LABELS[group.id])}
              </Text>
              <Card>
                {categoriesInGroup(group.id).map((item, index) => (
                  <View key={item.id}>
                    {index > 0 && <Divider inset={68} />}
                    <ListRow
                      icon={item.icon}
                      tone={item.handling === "private" ? "primary" : GROUP_TONES[group.id]}
                      title={categoryName(item.id, item.label, language)}
                      description={item.handling === "private" ? t.privateShort : undefined}
                      accessibilityLabel={categoryName(item.id, item.label, language)}
                      onPress={() => {
                        setCategory(item);
                        setStep("location");
                      }}
                    />
                  </View>
                ))}
              </Card>
            </>
          )}

          {step === "location" && (
            <>
              <Text style={styles.question} accessibilityRole="header">
                {t.whereDidItHappen}
              </Text>
              {locating ? (
                <ActivityIndicator size="large" color={c.primary} />
              ) : (
                <View style={styles.list}>
                  <Button
                    label={t.whereIAmNow}
                    icon="crosshairs-gps"
                    variant="primary"
                    large
                    onPress={() => void takeCurrentLocation()}
                  />
                  <Button
                    label={t.chooseOnMap}
                    icon="map-marker-radius"
                    large
                    onPress={() => void chooseOnMap()}
                  />
                </View>
              )}
              {locationError && <Note tone="warning">{locationError}</Note>}
              <Note icon="shield-lock-outline">{t.locationStaysHere}</Note>
            </>
          )}

          {step === "details" && category && (
            <>
              <Text style={styles.question} accessibilityRole="header">
                {categoryName(category.id, category.label, language)}
              </Text>
              {category.handling === "private" ? (
                <Note tone="warning" icon="lock-outline">
                  {t.privateOnlyStaff}
                </Note>
              ) : null}
              <Text style={styles.fieldLabel}>{t.anythingElse}</Text>
              <TextInput
                style={styles.input}
                multiline
                maxLength={MAX_DESCRIPTION_LENGTH}
                value={description}
                onChangeText={setDescription}
                placeholder={t.describePlaceholder}
                accessibilityLabel="Description"
              />
              <Text style={styles.counter}>
                {description.length}/{MAX_DESCRIPTION_LENGTH}
              </Text>
              <Note>{t.noNames}</Note>
              <AttachmentPicker attachments={attachments} onChange={setAttachments} />
              <Button
                label={t.sendReport}
                variant="primary"
                icon="check-circle"
                large
                onPress={() => void send()}
              />
            </>
          )}

          {step === "sending" && (
            <View style={styles.sending}>
              <ActivityIndicator size="large" color={c.primary} />
            </View>
          )}

          {step === "done" && outcome && (
            <>
              <View style={styles.doneIcon}>
                <IconTile
                  icon={
                    outcome.tone === "error"
                      ? "alert-circle-outline"
                      : outcome.tone === "queued"
                        ? "clock-outline"
                        : "check"
                  }
                  tone={outcome.tone === "error" ? "danger" : "primary"}
                  size={80}
                  round
                />
              </View>
              <Text style={styles.doneText}>{outcome.message}</Text>
              {category?.handling === "private" && outcome.tone !== "error" && (
                <SupportReferral categoryId={category.id} language={language} />
              )}
              <Button label={t.backToMap} variant="primary" large onPress={onClose} />
              <EmergencyCallButton />
            </>
          )}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

/** After a private report: where to get help. Only services Warden has confirmed are listed. */
function SupportReferral({ categoryId, language }: { categoryId: string; language: Language }) {
  const t = strings(language);
  const styles = useStyles(makeStyles);
  const services = supportFor(categoryId);
  return (
    <Card style={styles.support}>
      <View style={styles.supportHead}>
        <IconTile icon="hand-heart" tone="primary" size={40} />
        <Text style={styles.supportTitle}>{t.thankYouPrivate}</Text>
      </View>
      <Text style={styles.supportText}>{t.privateHelp}</Text>
      {services.map((service) => (
        <Button
          key={service.id}
          label={`${service.name}: ${t.call(service.phone)}`}
          icon="phone"
          onPress={() => void Linking.openURL(`tel:${service.phone.replace(/[^\d+]/g, "")}`)}
        />
      ))}
      {services.length === 0 && <Text style={styles.supportText}>{t.supportBeingConfirmed}</Text>}
    </Card>
  );
}

function Tile({
  label,
  icon,
  tone,
  onPress,
}: {
  label: string;
  icon: string;
  tone: Tone;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <IconTile icon={icon} tone={tone} size={42} />
      <Text style={styles.tileText}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40, gap: 14 },
    stepLabel: { fontFamily: MONO, fontSize: 13, color: c.muted, marginBottom: -8 },
    question: { fontSize: 26, lineHeight: 32, fontWeight: "800", color: c.text },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    tile: {
      flexBasis: "47%",
      flexGrow: 1,
      minHeight: 108,
      borderRadius: 18,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      padding: 14,
      gap: 12,
      justifyContent: "space-between",
    },
    tileText: { fontSize: 16, lineHeight: 21, fontWeight: "700", color: c.text },
    privateTile: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      padding: 16,
      borderRadius: 18,
      borderWidth: 2,
      borderColor: c.primary,
      backgroundColor: c.surface,
    },
    privateText: { flex: 1, gap: 3 },
    privateTitle: { fontSize: 16, fontWeight: "700", color: c.text },
    privateNote: { fontSize: 14, lineHeight: 19, color: c.muted },
    footerLine: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4 },
    footerText: { flex: 1, fontSize: 14.5, lineHeight: 20, color: c.muted },
    list: { gap: 10 },
    pressed: { opacity: 0.75 },
    fieldLabel: { fontSize: 16, fontWeight: "700", color: c.text },
    input: {
      minHeight: 120,
      textAlignVertical: "top",
      borderWidth: 1,
      borderColor: c.borderStrong,
      borderRadius: 14,
      padding: 14,
      fontSize: 17,
      lineHeight: 23,
      backgroundColor: c.surface,
    },
    counter: {
      alignSelf: "flex-end",
      color: c.muted,
      fontSize: 13,
      fontFamily: MONO,
      marginTop: -6,
    },
    sending: { paddingVertical: 48, alignItems: "center" },
    doneIcon: { alignItems: "center", marginTop: 24 },
    support: { padding: 16, gap: 10 },
    supportHead: { flexDirection: "row", alignItems: "center", gap: 12 },
    supportTitle: { flex: 1, fontSize: 18, fontWeight: "800", color: c.text },
    supportText: { fontSize: 15, lineHeight: 21, color: c.text },
    doneText: {
      fontSize: 19,
      lineHeight: 26,
      fontWeight: "700",
      textAlign: "center",
      color: c.text,
      marginBottom: 8,
    },
  });
