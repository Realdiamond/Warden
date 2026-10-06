import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SMS from "expo-sms";
import { useEffect, useState } from "react";
import { ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, EmergencyCallButton, ModalHeader, Note } from "../components/ui.tsx";
import { loadProfile, type SafetyProfile } from "../lib/contacts.ts";
import { checkPin, loadPins, type PinSettings } from "../lib/pin.ts";
import { type ActiveSession, minutesLeft, shareText } from "../lib/safety.ts";
import { COLORS } from "../lib/ui.ts";
import { sha256Hex } from "./SafetyScreen.tsx";

type Outcome = "arrived" | "safe" | "cancelled";

function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function SessionScreen({
  session,
  demo,
  onExtend,
  onFinish,
  onClose,
}: {
  session: ActiveSession;
  demo: boolean;
  onExtend: (minutes: number) => Promise<void>;
  /** Resolves once the phone has stopped sharing. */
  onFinish: (outcome: Outcome, duress: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<SafetyProfile | null>(null);
  const [pins, setPins] = useState<PinSettings | null>(null);
  const [stopping, setStopping] = useState<Outcome | null>(null);
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
  const message = shareText(session.kind, profile?.personName ?? "", session.viewUrl);

  const textContacts = async () => {
    const phones = profile?.contacts.map((c) => c.phone) ?? [];
    if (phones.length > 0 && (await SMS.isAvailableAsync())) {
      await SMS.sendSMSAsync(phones, message);
    } else {
      await Share.share({ message });
    }
  };

  const stop = async (outcome: Outcome, duress: boolean) => {
    setBusy(true);
    try {
      await onFinish(outcome, duress);
    } finally {
      setBusy(false);
    }
  };

  const confirmPin = async () => {
    if (!stopping) return;
    const result = await checkPin(pins, pin, sha256Hex);
    if (result === "wrong") {
      setPinError("Wrong PIN. Try again.");
      setPin("");
      return;
    }
    // A duress PIN stops exactly like the real one on this screen.
    await stop(stopping, result === "duress");
  };

  const askToStop = (outcome: Outcome) => {
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
        <ModalHeader title="Enter your PIN" onClose={onClose} onBack={() => setStopping(null)} />
        <View style={styles.body}>
          <Text style={styles.help}>Enter your Warden PIN to stop sharing.</Text>
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
            label={busy ? "Stopping..." : "Stop"}
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
      <ModalHeader title={sos ? "SOS is on" : "Sharing your trip"} onClose={onClose} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={[styles.status, sos && styles.statusSos]}>
          <Text style={[styles.statusTitle, sos && styles.statusTitleSos]}>
            {sos
              ? "Your trusted contacts are being alerted"
              : left !== null && left < 0
                ? `You are ${-left} min late`
                : `Expected by ${session.expectedArrivalAt ? clock(session.expectedArrivalAt) : "--"}`}
          </Text>
          <Text style={styles.statusText}>
            {sos
              ? "Warden is sharing your live location with them until you say you are safe."
              : left !== null && left < -10
                ? "Your contacts have been told you are late. Add time or say you have arrived."
                : left !== null && left >= 0
                  ? `${left} min left${session.destinationLabel ? ` to ${session.destinationLabel}` : ""}.`
                  : "Add time or say you have arrived, or your contacts will be told."}
          </Text>
          {session.pending.length > 0 && (
            <Text style={styles.statusText}>
              {session.pending.length} location update(s) waiting for signal.
            </Text>
          )}
        </View>

        {sos && <EmergencyCallButton />}

        {demo ? (
          <Note tone="warning">Demo mode: no one was alerted and no link was made.</Note>
        ) : (
          <>
            <Button
              label={sos ? "Text my contacts now" : "Send the link to my contacts"}
              variant={sos ? "danger" : "secondary"}
              icon="message-text"
              onPress={() => void textContacts()}
            />
            {session.viewUrl && (
              <Button
                label="Share the link another way"
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
          label={sos ? "I'm safe now" : "I've arrived"}
          variant="primary"
          icon="check-circle"
          disabled={busy}
          onPress={() => askToStop(sos ? "safe" : "arrived")}
        />
        {!sos && (
          <Button
            label="Cancel trip"
            icon="close"
            disabled={busy}
            onPress={() => askToStop("cancelled")}
          />
        )}
        {sos && profile && profile.contacts.length === 0 && (
          <Note tone="warning">
            You have no trusted contacts, so Warden cannot alert anyone. Call 112, or share the link
            with someone you trust.
          </Note>
        )}
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
