import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SafeStop } from "@warden/shared";
import * as SMS from "expo-sms";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import { SafePlaces } from "../components/SafePlaces.tsx";
import { Text, TextInput } from "../components/text.tsx";
import { useStyles, useTheme } from "../components/theme.tsx";
import {
  Button,
  Card,
  Divider,
  EmergencyCallButton,
  Icon,
  IconTile,
  ModalHeader,
  Note,
  SectionLabel,
} from "../components/ui.tsx";
import { loadProfile, type SafetyProfile } from "../lib/contacts.ts";
import { type Language, strings } from "../lib/i18n.ts";
import type { Position } from "../lib/location.ts";
import { checkPin, loadPins, type PinSettings } from "../lib/pin.ts";
import { type ActiveSession, minutesLeft, shareText } from "../lib/safety.ts";
import { MONO, type Palette } from "../lib/theme.ts";
import { sha256Hex } from "./SafetyScreen.tsx";

type Outcome = "arrived" | "safe" | "cancelled";
/** What the PIN is being asked for: stopping, or answering "Are you OK?". */
type PinFor = Outcome | "checkIn";

function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function minutesSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
}

export function SessionScreen({
  session,
  demo,
  language,
  onExtend,
  onFinish,
  onAnswerCheckIn,
  findStops,
  onClose,
}: {
  session: ActiveSession;
  demo: boolean;
  language: Language;
  onExtend: (minutes: number) => Promise<void>;
  /** Resolves once the phone has stopped sharing. */
  onFinish: (outcome: Outcome, duress: boolean) => Promise<void>;
  /** The person said they are OK; with the duress PIN, contacts are quietly told otherwise. */
  onAnswerCheckIn: (duress: boolean) => Promise<void>;
  findStops: (around: Position) => Promise<SafeStop[]>;
  onClose: () => void;
}) {
  const t = strings(language);
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [profile, setProfile] = useState<SafetyProfile | null>(null);
  const [pins, setPins] = useState<PinSettings | null>(null);
  const [stopping, setStopping] = useState<PinFor | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    void (async () => {
      setProfile(await loadProfile(AsyncStorage));
      setPins(await loadPins(AsyncStorage));
    })();
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const sos = session.kind === "sos";
  const left = minutesLeft(session, now);
  const message = shareText(session.kind, profile?.personName ?? "", session.viewUrl, language);
  const checkIn = session.checkIn ?? null;
  const checkInMinutes = checkIn
    ? Math.max(0, Math.ceil((new Date(checkIn.dueAt).getTime() - now.getTime()) / 60_000))
    : 0;
  const hasPin = !!pins?.pinHash;

  const textContacts = async () => {
    const phones = profile?.contacts.map((c) => c.phone) ?? [];
    if (phones.length > 0 && (await SMS.isAvailableAsync())) {
      await SMS.sendSMSAsync(phones, message);
    } else {
      await Share.share({ message });
    }
  };

  const stop = async (outcome: PinFor, duress: boolean) => {
    setBusy(true);
    try {
      if (outcome === "checkIn") {
        await onAnswerCheckIn(duress);
        setStopping(null);
      } else {
        await onFinish(outcome, duress);
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmPin = async () => {
    if (!stopping) return;
    const result = await checkPin(pins, pin, sha256Hex);
    if (result === "wrong") {
      setPinError(t.wrongPin);
      setPin("");
      return;
    }
    // A duress PIN behaves exactly like the real one on this screen.
    await stop(stopping, result === "duress");
  };

  const askToStop = (outcome: PinFor) => {
    if (pins?.pinHash) {
      setStopping(outcome);
      setPin("");
      setPinError(null);
    } else {
      void stop(outcome, false);
    }
  };

  if (stopping) {
    return (
      <View style={styles.screen}>
        <ModalHeader title={t.enterPin} onClose={onClose} onBack={() => setStopping(null)} />
        <View style={styles.body}>
          <Text style={styles.help}>
            {stopping === "checkIn" ? t.enterPinToAnswer : t.enterPinToStop}
          </Text>
          <TextInput
            style={styles.pinInput}
            value={pin}
            onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            secureTextEntry
            autoFocus
            accessibilityLabel="PIN"
          />
          {pinError && <Text style={styles.error}>{pinError}</Text>}
          <Button
            label={busy ? t.stopping : stopping === "checkIn" ? t.imOk : t.stop}
            variant="primary"
            large
            disabled={busy || pin.length < 4}
            onPress={() => void confirmPin()}
          />
        </View>
      </View>
    );
  }

  const contacts = profile?.contacts ?? [];
  const pending =
    session.pending.length > 0 ? (
      <Text style={styles.pending}>{t.waitingForSignal(session.pending.length)}</Text>
    ) : null;

  const checkInCard = checkIn ? (
    <View style={styles.checkIn}>
      <Text style={styles.checkInTitle} accessibilityRole="header">
        {t.areYouOk}
      </Text>
      <Text style={styles.statusText}>{t.awayFromRoute(session.destinationLabel)}</Text>
      <Text style={styles.statusText}>
        {checkIn.flagged ? t.contactsTold : t.contactsToldIn(checkInMinutes)}
      </Text>
      <Button
        label={t.imOk}
        variant="primary"
        icon="check-circle"
        large
        disabled={busy}
        onPress={() => askToStop("checkIn")}
      />
    </View>
  ) : null;

  const shareButtons = demo ? (
    <Note tone="warning">{t.demoNoAlert}</Note>
  ) : (
    <>
      <Button
        label={sos ? t.textContactsNow : t.sendLink}
        icon="message-text"
        onPress={() => void textContacts()}
      />
      {session.viewUrl && (
        <Button
          label={t.shareOtherWay}
          icon="share-variant"
          onPress={() => void Share.share({ message })}
        />
      )}
    </>
  );

  if (sos) {
    return (
      <View style={styles.screen}>
        <View style={styles.sosHeader}>
          <View style={styles.liveDot} />
          <View style={styles.sosHeaderText}>
            <Text style={styles.sosTitle} accessibilityRole="header">
              {t.sosOn}
            </Text>
            <Text style={styles.sosSubtitle}>{t.sharingLive}</Text>
          </View>
          <Text style={styles.elapsed}>{minutesSince(session.startedAt, now)} min</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={styles.close}
          >
            <Icon name="close" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          {checkInCard}
          <Card>
            <View style={styles.cardLabel}>
              <SectionLabel>{t.whoIsTold}</SectionLabel>
            </View>
            {contacts.map((contact, index) => (
              <View key={contact.id}>
                {index > 0 && <Divider inset={68} />}
                <View style={styles.personRow}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {contact.name.trim().charAt(0).toUpperCase() || "?"}
                    </Text>
                  </View>
                  <View style={styles.personText}>
                    <Text style={styles.personName}>{contact.name}</Text>
                    <Text style={styles.personDetail}>
                      {demo ? t.demoNotReal.trim() : t.getsText}
                    </Text>
                  </View>
                  <Icon name="message-text-outline" size={22} color={c.muted} />
                </View>
              </View>
            ))}
            {profile && contacts.length === 0 && (
              <View style={styles.cardPad}>
                <Note tone="warning">{t.noContacts}</Note>
              </View>
            )}
            {profile?.shareSosWithResponders && (
              <>
                {contacts.length > 0 && <Divider inset={68} />}
                <View style={styles.personRow}>
                  <IconTile icon="shield-outline" tone="responder" size={40} round />
                  <View style={styles.personText}>
                    <Text style={styles.personName}>{t.respondersNear}</Text>
                    <Text style={styles.personDetail}>{t.respondersCanSee}</Text>
                  </View>
                </View>
              </>
            )}
          </Card>
          {pending}

          <EmergencyCallButton label={t.call112} />

          {shareButtons}

          <View style={styles.safeGroup}>
            <Button
              label={t.imSafe}
              variant="primary"
              icon={hasPin ? "lock-outline" : "check-circle"}
              large
              disabled={busy}
              onPress={() => askToStop("safe")}
            />
            {hasPin && <Text style={styles.needsPin}>{t.needsPin}</Text>}
          </View>

          <SafePlaces findStops={findStops} language={language} />
        </ScrollView>
      </View>
    );
  }

  const late = left !== null && left < 0;

  return (
    <View style={styles.screen}>
      <ModalHeader title={t.sharingTrip} onClose={onClose} />
      <ScrollView contentContainerStyle={styles.body}>
        {checkInCard}

        <Card style={[styles.status, late && styles.statusLate]}>
          <Text style={[styles.statusTitle, late && styles.statusTitleLate]}>
            {late
              ? t.late(-(left ?? 0))
              : t.expectedBy(session.expectedArrivalAt ? clock(session.expectedArrivalAt) : "--")}
          </Text>
          <Text style={styles.statusText}>
            {left !== null && left < -10
              ? t.toldLate
              : left !== null && left >= 0
                ? t.minLeft(left, session.destinationLabel)
                : t.addTimeOr}
          </Text>
          {pending}
        </Card>

        {shareButtons}

        <View style={styles.row}>
          <View style={styles.flex}>
            <Button label="+15 min" icon="clock-plus-outline" onPress={() => void onExtend(15)} />
          </View>
          <View style={styles.flex}>
            <Button label="+30 min" icon="clock-plus-outline" onPress={() => void onExtend(30)} />
          </View>
        </View>

        <Button
          label={t.arrived}
          variant="primary"
          icon="check-circle"
          large
          disabled={busy}
          onPress={() => askToStop("arrived")}
        />
        <Button
          label={t.cancelTrip}
          icon="close"
          disabled={busy}
          onPress={() => askToStop("cancelled")}
        />
        <SafePlaces findStops={findStops} language={language} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 48, gap: 14 },
    help: { color: c.muted, fontSize: 16, lineHeight: 22 },
    error: { color: c.dangerText, fontWeight: "700", fontSize: 15 },
    sosHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingLeft: 20,
      paddingRight: 12,
      paddingTop: 12,
      paddingBottom: 10,
    },
    liveDot: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: c.dangerText,
      borderWidth: 5,
      borderColor: c.dangerSoft,
    },
    sosHeaderText: { flex: 1, gap: 2 },
    sosTitle: { fontSize: 26, lineHeight: 30, fontWeight: "800", color: c.text },
    sosSubtitle: { fontSize: 14.5, color: c.muted },
    elapsed: { fontFamily: MONO, fontSize: 15, color: c.muted },
    close: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    cardLabel: { paddingTop: 14, paddingHorizontal: 10, paddingBottom: 2 },
    cardPad: { padding: 12 },
    personRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 60,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.primarySoft,
    },
    avatarText: {
      fontSize: 17,
      fontWeight: "800",
      color: c.name === "dark" ? c.onPrimarySoft : c.primary,
    },
    personText: { flex: 1, gap: 2 },
    personName: { fontSize: 16, fontWeight: "700", color: c.text },
    personDetail: { fontSize: 14, lineHeight: 19, color: c.muted },
    pending: { fontSize: 14, color: c.muted },
    safeGroup: { gap: 6 },
    needsPin: { textAlign: "center", fontSize: 14, color: c.muted },
    checkIn: {
      padding: 16,
      gap: 8,
      borderRadius: 18,
      borderWidth: 2,
      borderColor: c.dangerText,
      backgroundColor: c.dangerSoft,
    },
    checkInTitle: {
      fontSize: 24,
      fontWeight: "800",
      color: c.name === "dark" ? c.onDangerSoft : c.danger,
    },
    status: { padding: 16, gap: 6 },
    statusLate: { borderColor: c.warningText, backgroundColor: c.warningSoft },
    statusTitle: { fontSize: 24, lineHeight: 30, fontWeight: "800", color: c.text },
    statusTitleLate: { color: c.warningText },
    statusText: { fontSize: 15.5, lineHeight: 22, color: c.text },
    row: { flexDirection: "row", gap: 8 },
    flex: { flex: 1 },
    pinInput: {
      minHeight: 64,
      borderWidth: 2,
      borderColor: c.borderStrong,
      borderRadius: 16,
      paddingHorizontal: 16,
      fontSize: 30,
      fontFamily: MONO,
      letterSpacing: 10,
      textAlign: "center",
      backgroundColor: c.surface,
    },
  });
