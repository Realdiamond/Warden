import Constants from "expo-constants";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Button, ModalHeader, Note } from "../components/ui.tsx";
import { LANGUAGE_NAMES, LANGUAGES, type Language } from "../lib/i18n.ts";
import {
  isValidReporterCode,
  isValidServerUrl,
  normaliseReporterCode,
  type Settings,
} from "../lib/settings.ts";
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
  const [language, setLanguage] = useState<Language>(settings.language);
  const [reporterCode, setReporterCode] = useState(settings.reporterCode);
  const validUrl = isValidServerUrl(apiUrl.trim());
  const validCode = isValidReporterCode(reporterCode);
  const valid = validUrl && validCode;

  return (
    <View style={styles.screen}>
      <ModalHeader title="Settings" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Language</Text>
        <View style={styles.choices} accessibilityRole="radiogroup">
          {LANGUAGES.map((id) => (
            <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityState={{ selected: language === id }}
              onPress={() => setLanguage(id)}
              style={[styles.choice, language === id && styles.choiceOn]}
            >
              <Text style={[styles.choiceText, language === id && styles.choiceTextOn]}>
                {LANGUAGE_NAMES[id]}
              </Text>
            </Pressable>
          ))}
        </View>
        {language === "pcm" && (
          <Text style={styles.help}>
            Alerts, SOS, trips and safe places are in Pidgin. This is a first version and is still
            being checked.
          </Text>
        )}

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
        {!validUrl && <Text style={styles.error}>Enter an address starting with https://</Text>}
        <Text style={styles.help}>For testing. Leave empty to use demo mode.</Text>

        <Text style={styles.label}>Trusted reporter code</Text>
        <TextInput
          style={styles.input}
          value={reporterCode}
          onChangeText={setReporterCode}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
          placeholderTextColor={COLORS.muted}
          accessibilityLabel="Trusted reporter code"
        />
        {!validCode && <Text style={styles.error}>That code does not look right.</Text>}
        <Text style={styles.help}>
          Only if Warden gave you one. Your reports are then shown sooner. They stay anonymous:
          Warden sees that a trusted reporter sent them, not who.
        </Text>

        <Button
          label="Save"
          variant="primary"
          disabled={!valid}
          onPress={() =>
            onSave({
              apiUrl: apiUrl.trim(),
              demoMode: demoMode || apiUrl.trim() === "",
              language,
              reporterCode: normaliseReporterCode(reporterCode),
            })
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
  choices: { flexDirection: "row", gap: 8 },
  choice: {
    flex: 1,
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
  },
  choiceOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  choiceText: { fontSize: 16, color: COLORS.text },
  choiceTextOn: { color: "#FFFFFF", fontWeight: "600" },
  version: { color: COLORS.muted, textAlign: "center", marginTop: 8 },
});
