import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, Vibration, View } from "react-native";
import { COLORS } from "../lib/ui.ts";

const SECONDS = 5;

/** A short countdown so a pocket press can be undone; "Send now" skips it. */
export function SosCountdown({ onSend, onCancel }: { onSend: () => void; onCancel: () => void }) {
  const [left, setLeft] = useState(SECONDS);
  const sent = useRef(false);

  useEffect(() => {
    Vibration.vibrate([0, 300, 200, 300]);
    const timer = setInterval(() => setLeft((value) => value - 1), 1_000);
    return () => clearInterval(timer);
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

  return (
    <View style={styles.screen} accessibilityViewIsModal>
      <Text style={styles.title} accessibilityRole="header">
        Sending SOS
      </Text>
      <Text style={styles.count} accessibilityLiveRegion="assertive">
        {Math.max(0, left)}
      </Text>
      <Text style={styles.text}>
        Your trusted contacts will get your live location. Then you can call 112.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send SOS now"
        onPress={sendNow}
        style={[styles.button, styles.send]}
      >
        <Text style={styles.sendText}>Send now</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel SOS"
        onPress={onCancel}
        style={[styles.button, styles.cancel]}
      >
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 20,
    backgroundColor: COLORS.danger,
  },
  title: { fontSize: 28, fontWeight: "800", color: "#FFFFFF" },
  count: { fontSize: 120, fontWeight: "800", color: "#FFFFFF" },
  text: { fontSize: 18, color: "#FFFFFF", textAlign: "center" },
  button: {
    alignSelf: "stretch",
    minHeight: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  send: { backgroundColor: "#FFFFFF" },
  sendText: { fontSize: 20, fontWeight: "800", color: COLORS.danger },
  cancel: { borderWidth: 2, borderColor: "#FFFFFF" },
  cancelText: { fontSize: 20, fontWeight: "700", color: "#FFFFFF" },
});
