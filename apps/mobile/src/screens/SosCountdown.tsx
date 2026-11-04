import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Vibration, View } from "react-native";
import { Text } from "../components/text.tsx";
import { useStyles } from "../components/theme.tsx";
import { loadProfile } from "../lib/contacts.ts";
import { type Language, strings } from "../lib/i18n.ts";
import { MONO, type Palette } from "../lib/theme.ts";

const SECONDS = 5;

/** "Mum", "Mum and Tunde", "Mum, Tunde and Ada". */
function nameList(names: string[], and: string): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
}

/** A short countdown so a pocket press can be undone; "Send now" skips it. */
export function SosCountdown({
  onSend,
  onCancel,
  language,
}: {
  onSend: () => void;
  onCancel: () => void;
  language: Language;
}) {
  const t = strings(language);
  const styles = useStyles(makeStyles);
  const [left, setLeft] = useState(SECONDS);
  const [names, setNames] = useState<string[]>([]);
  const sent = useRef(false);

  useEffect(() => {
    Vibration.vibrate([0, 300, 200, 300]);
    const timer = setInterval(() => setLeft((value) => value - 1), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    void loadProfile(AsyncStorage)
      .then((profile) => setNames(profile.contacts.map((contact) => contact.name.trim())))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (left <= 0 && !sent.current) {
      sent.current = true;
      onSend();
    }
  }, [left, onSend]);

  const sendNow = () => {
    if (sent.current) return;
    sent.current = true;
    onSend();
  };

  const shown = Math.max(0, left);
  const who = names.filter(Boolean);

  return (
    <View style={styles.screen} accessibilityViewIsModal>
      <Text style={styles.title} accessibilityRole="header">
        {t.sendingSos}
      </Text>

      <View style={styles.counter}>
        <Text style={styles.count} accessibilityLiveRegion="assertive">
          {shown}
        </Text>
        <Text style={styles.secondsLabel}>{t.seconds}</Text>
        <View style={styles.segments} accessible={false}>
          {Array.from({ length: SECONDS }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed, ordered segments
            <View key={i} style={[styles.segment, i < shown && styles.segmentLeft]} />
          ))}
        </View>
      </View>

      <Text style={styles.text}>
        {who.length > 0 ? t.willGetLocation(nameList(who, t.and)) : t.sosWillSend}
      </Text>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.sendNow}
          onPress={sendNow}
          style={({ pressed }) => [styles.button, styles.send, pressed && styles.pressed]}
        >
          <Text style={styles.sendText}>{t.sendNow}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.cancel}
          onPress={onCancel}
          style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}
        >
          <Text style={styles.cancelText}>{t.cancel}</Text>
        </Pressable>
        <Text style={styles.mistake}>{t.pressedByMistake}</Text>
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      alignItems: "center",
      paddingHorizontal: 28,
      paddingTop: 56,
      paddingBottom: 36,
      gap: 28,
      backgroundColor: c.danger,
    },
    title: { fontSize: 32, fontWeight: "800", color: c.onDanger, textAlign: "center" },
    counter: { alignItems: "center", gap: 6 },
    count: {
      fontSize: 140,
      lineHeight: 150,
      fontWeight: "700",
      fontFamily: MONO,
      color: c.onDanger,
    },
    secondsLabel: { fontSize: 16, fontWeight: "700", color: c.onDanger, opacity: 0.9 },
    segments: { flexDirection: "row", gap: 8, width: 240, marginTop: 14 },
    segment: {
      flex: 1,
      height: 10,
      borderRadius: 5,
      backgroundColor: c.onDanger,
      opacity: 0.28,
    },
    segmentLeft: { opacity: 1 },
    text: {
      fontSize: 20,
      lineHeight: 28,
      fontWeight: "700",
      color: c.onDanger,
      textAlign: "center",
      maxWidth: 320,
    },
    actions: { marginTop: "auto", alignSelf: "stretch", gap: 12 },
    button: {
      minHeight: 60,
      borderRadius: 30,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 20,
    },
    send: { backgroundColor: c.onDanger },
    sendText: { fontSize: 20, fontWeight: "800", color: c.danger },
    cancel: { borderWidth: 2, borderColor: c.onDanger },
    cancelText: { fontSize: 20, fontWeight: "800", color: c.onDanger },
    pressed: { opacity: 0.8 },
    mistake: {
      marginTop: 4,
      fontSize: 15,
      lineHeight: 21,
      color: c.onDanger,
      opacity: 0.9,
      textAlign: "center",
    },
  });
