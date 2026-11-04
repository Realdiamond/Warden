import Constants from "expo-constants";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text, TextInput } from "../components/text.tsx";
import { useStyles } from "../components/theme.tsx";
import {
  Button,
  Card,
  ModalHeader,
  Note,
  SectionLabel,
  SegmentedControl,
  SwitchRow,
} from "../components/ui.tsx";
import { LANGUAGE_NAMES, LANGUAGES, type Language } from "../lib/i18n.ts";
import {
  isValidReporterCode,
  isValidServerUrl,
  normaliseReporterCode,
  type Settings,
} from "../lib/settings.ts";
import { MONO, type Palette, type ThemeSetting } from "../lib/theme.ts";

const NIGHT_MODES: { value: ThemeSetting; label: string; accessibilityLabel: string }[] = [
  { value: "system", label: "System", accessibilityLabel: "Night mode follows the phone" },
  { value: "light", label: "Light", accessibilityLabel: "Always light" },
  { value: "dark", label: "Dark", accessibilityLabel: "Always dark" },
];

export function SettingsScreen({
  settings,
  onSave,
  onClose,
}: {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  const [demoMode, setDemoMode] = useState(settings.demoMode);
  const [language, setLanguage] = useState<Language>(settings.language);
  const [reporterCode, setReporterCode] = useState(settings.reporterCode);
  const [theme, setTheme] = useState<ThemeSetting>(settings.theme);
  const validUrl = isValidServerUrl(apiUrl.trim());
  const validCode = isValidReporterCode(reporterCode);
  const valid = validUrl && validCode;

  return (
    <View style={styles.screen}>
      <ModalHeader title="Settings" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <SectionLabel>Language</SectionLabel>
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
        </View>

        <View style={styles.section}>
          <SectionLabel>Night mode</SectionLabel>
          <View style={styles.segmentRow}>
            <SegmentedControl
              options={NIGHT_MODES}
              value={theme}
              onChange={setTheme}
              accessibilityLabel="Night mode"
            />
          </View>
          <Text style={styles.help}>
            Dark colours keep the screen dim at night. System follows your phone's setting.
          </Text>
        </View>

        <Card>
          <SwitchRow
            title="Demo mode"
            description="Shows sample incidents. Reports are not sent anywhere."
            value={demoMode}
            onValueChange={setDemoMode}
          />
        </Card>

        <View style={styles.section}>
          <SectionLabel>Server address</SectionLabel>
          <TextInput
            style={styles.input}
            value={apiUrl}
            onChangeText={setApiUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://api.example.ng"
            accessibilityLabel="Server address"
          />
          {!validUrl && <Text style={styles.error}>Enter an address starting with https://</Text>}
          <Text style={styles.help}>For testing. Leave empty to use demo mode.</Text>
        </View>

        <View style={styles.section}>
          <SectionLabel>Trusted reporter code</SectionLabel>
          <TextInput
            style={[styles.input, styles.code]}
            value={reporterCode}
            onChangeText={setReporterCode}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
            accessibilityLabel="Trusted reporter code"
          />
          {!validCode && <Text style={styles.error}>That code does not look right.</Text>}
          <Text style={styles.help}>
            Only if Warden gave you one. Your reports are then shown sooner. They stay anonymous:
            Warden sees that a trusted reporter sent them, not who.
          </Text>
        </View>

        <Button
          label="Save"
          variant="primary"
          large
          disabled={!valid}
          onPress={() =>
            onSave({
              apiUrl: apiUrl.trim(),
              demoMode: demoMode || apiUrl.trim() === "",
              language,
              reporterCode: normaliseReporterCode(reporterCode),
              theme,
            })
          }
        />

        <Note icon="shield-check-outline">
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

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    body: { padding: 16, gap: 18, paddingBottom: 32 },
    section: { gap: 8 },
    segmentRow: { flexDirection: "row" },
    help: { color: c.muted, fontSize: 14, lineHeight: 20, paddingHorizontal: 2 },
    input: {
      minHeight: 52,
      borderWidth: 1,
      borderColor: c.borderStrong,
      borderRadius: 14,
      paddingHorizontal: 16,
      fontSize: 17,
      color: c.text,
      backgroundColor: c.surface,
    },
    code: { fontFamily: MONO, letterSpacing: 1 },
    error: { color: c.dangerText, fontSize: 14, fontWeight: "700" },
    choices: { flexDirection: "row", gap: 8 },
    choice: {
      flex: 1,
      minHeight: 48,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.borderStrong,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
    },
    choiceOn: { borderColor: c.primary, backgroundColor: c.primary },
    choiceText: { fontSize: 16, fontWeight: "600", color: c.text },
    choiceTextOn: { color: c.onPrimary, fontWeight: "700" },
    version: { color: c.muted, textAlign: "center", marginTop: 4, fontFamily: MONO, fontSize: 13 },
  });
