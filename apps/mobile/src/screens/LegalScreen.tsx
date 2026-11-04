// The privacy notice or terms of use (M11), from packages/shared so the app and the website show
// the same words. Optionally ends with a button to accept a new version.

import { LEGAL_DOCUMENTS } from "@warden/shared";
import { ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../components/text.tsx";
import { useStyles } from "../components/theme.tsx";
import { Button, ModalHeader, Note } from "../components/ui.tsx";
import type { Palette } from "../lib/theme.ts";

export type LegalDocumentId = keyof typeof LEGAL_DOCUMENTS;

export function LegalScreen({
  doc,
  onClose,
  onBack,
  onAccept,
  onReadOther,
}: {
  doc: LegalDocumentId;
  onClose: () => void;
  onBack?: () => void;
  /** Shown as "I agree" at the end, for a new version people have not accepted yet. */
  onAccept?: () => void;
  /** A link to the other document, for reading both before agreeing. */
  onReadOther?: () => void;
}) {
  const styles = useStyles(makeStyles);
  const document = LEGAL_DOCUMENTS[doc];
  return (
    <View style={styles.screen}>
      <ModalHeader title={document.title} onClose={onClose} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body}>
        {document.draft && (
          <Note tone="warning">
            Draft: this text has not yet been checked by a lawyer and may change before Warden
            launches.
          </Note>
        )}
        {document.sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.heading} accessibilityRole="header">
              {section.heading}
            </Text>
            {section.paragraphs.map((paragraph) => (
              <Text key={paragraph} style={styles.paragraph}>
                {paragraph}
              </Text>
            ))}
          </View>
        ))}
        <Text style={styles.version}>Version {document.version}</Text>
        {onReadOther && (
          <Button
            label={doc === "privacy" ? "Read the terms of use" : "Read the privacy notice"}
            variant="text"
            icon="file-document-outline"
            onPress={onReadOther}
          />
        )}
        {onAccept && (
          <Button
            label="I agree to the privacy notice and terms"
            variant="primary"
            large
            onPress={onAccept}
          />
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    body: { padding: 16, paddingBottom: 32, gap: 18 },
    section: { gap: 8 },
    heading: { fontSize: 19, fontWeight: "800", color: c.text },
    paragraph: { fontSize: 16, lineHeight: 23, color: c.text },
    version: { fontSize: 13, color: c.muted },
  });
