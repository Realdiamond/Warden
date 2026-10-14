import Constants from "expo-constants";
import { useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Button, ModalHeader, Note } from "../components/ui.tsx";
import { isValidServerUrl, type Settings } from "../lib/settings.ts";
import { COLORS } from "../lib/ui.ts";

export function SettingsScreen({
  settings,
  onSave,
  onClose,
}: {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}) {
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  const [demoMode, setDemoMode] = useState(settings.demoMode);
  const valid = isValidServerUrl(apiUrl.trim());

  return (
    <View style={styles.screen}>
      <ModalHeader title="Settings" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Demo mode</Text>
            <Text style={styles.help}>Shows sample incidents. Reports are not sent anywhere.</Text>
          </View>
          <Switch value={demoMode} onValueChange={setDemoMode} accessibilityLabel="Demo mode" />
        </View>

        <Text style={styles.label}>Server address</Text>
        <TextInput
          style={styles.input}
          value={apiUrl}
          onChangeText={setApiUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://api.example.ng"
          placeholderTextColor={COLORS.muted}
          accessibilityLabel="Server address"
        />
        {!valid && <Text style={styles.error}>Enter an address starting with https://</Text>}
        <Text style={styles.help}>For testing. Leave empty to use demo mode.</Text>

        <Button
          label="Save"
          variant="primary"
          disabled={!valid}
          onPress={() =>
            onSave({ apiUrl: apiUrl.trim(), demoMode: demoMode || apiUrl.trim() === "" })
          }
        />

        <Note>
          Warden keeps you anonymous. Reports carry the place you choose, never your name or your
          own location. Public maps show areas, not exact spots. Warden does not replace 112.
        </Note>
        <Text style={styles.version}>
          Warden {Constants.expoConfig?.version ?? ""} (test build)
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  body: { padding: 16, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowText: { flex: 1 },
  label: { fontSize: 16, fontWeight: "600", color: COLORS.text },
  help: { color: COLORS.muted, fontSize: 13 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.surface,
  },
  error: { color: COLORS.danger },
  version: { color: COLORS.muted, textAlign: "center", marginTop: 8 },
});
