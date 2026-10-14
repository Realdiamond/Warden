import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SafeStop } from "@warden/shared";
import * as SMS from "expo-sms";
import { useEffect, useState } from "react";
import { ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { SafePlaces } from "../components/SafePlaces.tsx";
import { Button, EmergencyCallButton, ModalHeader, Note } from "../components/ui.tsx";
import { loadProfile, type SafetyProfile } from "../lib/contacts.ts";
import { type Language, strings } from "../lib/i18n.ts";
import type { Position } from "../lib/location.ts";
import { checkPin, loadPins, type PinSettings } from "../lib/pin.ts";
import { type ActiveSession, minutesLeft, shareText } from "../lib/safety.ts";
import { COLORS } from "../lib/ui.ts";
import { sha256Hex } from "./SafetyScreen.tsx";

type Outcome = "arrived" | "safe" | "cancelled";
/** What the PIN is being asked for: stopping, or answering "Are you OK?". */
type PinFor = Outcome | "checkIn";

function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
            disabled={busy || pin.length < 4}
            onPress={() => void confirmPin()}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ModalHeader title={sos ? t.sosOn : t.sharingTrip} onClose={onClose} />
      <ScrollView contentContainerStyle={styles.body}>
        {checkIn && (
          <View style={[styles.status, styles.statusSos]}>
            <Text style={[styles.statusTitle, styles.statusTitleSos]}>{t.areYouOk}</Text>
            <Text style={styles.statusText}>{t.awayFromRoute(session.destinationLabel)}</Text>
            <Text style={styles.statusText}>
              {checkIn.flagged ? t.contactsTold : t.contactsToldIn(checkInMinutes)}
            </Text>
            <Button
              label={t.imOk}
              variant="primary"
              icon="check-circle"
              disabled={busy}
              onPress={() => askToStop("checkIn")}
            />
          </View>
        )}
        <View style={[styles.status, sos && styles.statusSos]}>
          <Text style={[styles.statusTitle, sos && styles.statusTitleSos]}>
            {sos
              ? t.contactsAlerted
              : left !== null && left < 0
                ? t.late(-left)
                : t.expectedBy(session.expectedArrivalAt ? clock(session.expectedArrivalAt) : "--")}
          </Text>
          <Text style={styles.statusText}>
            {sos
              ? t.sharingUntilSafe
              : left !== null && left < -10
                ? t.toldLate
                : left !== null && left >= 0
                  ? t.minLeft(left, session.destinationLabel)
                  : t.addTimeOr}
          </Text>
          {session.pending.length > 0 && (
            <Text style={styles.statusText}>{t.waitingForSignal(session.pending.length)}</Text>
          )}
        </View>

        {sos && <EmergencyCallButton />}

        {demo ? (
          <Note tone="warning">{t.demoNoAlert}</Note>
        ) : (
          <>
            <Button
              label={sos ? t.textContactsNow : t.sendLink}
              variant={sos ? "danger" : "secondary"}
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
        )}

        {!sos && (
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button label="+15 min" icon="clock-plus-outline" onPress={() => void onExtend(15)} />
            </View>
            <View style={styles.flex}>
              <Button label="+30 min" icon="clock-plus-outline" onPress={() => void onExtend(30)} />
            </View>
          </View>
        )}

        <Button
          label={sos ? t.imSafe : t.arrived}
          variant="primary"
          icon="check-circle"
          disabled={busy}
          onPress={() => askToStop(sos ? "safe" : "arrived")}
        />
        {!sos && (
          <Button
            label={t.cancelTrip}
            icon="close"
            disabled={busy}
            onPress={() => askToStop("cancelled")}
          />
        )}
        {sos && profile && profile.contacts.length === 0 && (
          <Note tone="warning">{t.noContacts}</Note>
        )}
        <SafePlaces findStops={findStops} language={language} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 16, gap: 12, paddingBottom: 48 },
  help: { color: COLORS.muted, fontSize: 16 },
  error: { color: COLORS.danger, fontWeight: "600" },
  status: {
    padding: 16,
    borderRadius: 14,
    gap: 6,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statusSos: { backgroundColor: "#FDE7E5", borderColor: COLORS.danger },
  statusTitle: { fontSize: 20, fontWeight: "700", color: COLORS.text },
  statusTitleSos: { color: "#8F1D14" },
  statusText: { color: COLORS.text },
  row: { flexDirection: "row", gap: 8 },
  flex: { flex: 1 },
  pinInput: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 28,
    letterSpacing: 8,
    textAlign: "center",
    color: COLORS.text,
    backgroundColor: COLORS.surface,
  },
});
