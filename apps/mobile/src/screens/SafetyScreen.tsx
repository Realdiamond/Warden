import AsyncStorage from "@react-native-async-storage/async-storage";
import { MAX_CONTACTS, MAX_PERSON_NAME } from "@warden/shared";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import * as SMS from "expo-sms";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button, Icon, ModalHeader, Note } from "../components/ui.tsx";
import {
  displayPhone,
  inviteText,
  loadProfile,
  makeContact,
  type SafetyProfile,
  saveProfile,
} from "../lib/contacts.ts";
import { loadPins, type PinSettings, savePins, setUpPins } from "../lib/pin.ts";
import { COLORS } from "../lib/ui.ts";

export const sha256Hex = (text: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text);

export function SafetyScreen({ onClose }: { onClose: () => void }) {
  const [profile, setProfile] = useState<SafetyProfile | null>(null);
  const [pins, setPins] = useState<PinSettings | null>(null);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactError, setContactError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pinForm, setPinForm] = useState<{ pin: string; duress: string } | null>(null);
  const [pinMessage, setPinMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const loaded = await loadProfile(AsyncStorage);
      setProfile(loaded);
      setName(loaded.personName);
      setPins(await loadPins(AsyncStorage));
    })();
  }, []);

  const store = useCallback(async (next: SafetyProfile) => {
    setProfile(next);
    await saveProfile(AsyncStorage, next);
  }, []);

  const addContact = useCallback(async () => {
    if (!profile) return;
    const result = makeContact(profile.contacts, {
      id: randomUUID(),
      name: contactName,
      phone: contactPhone,
    });
    if (!result.ok) {
      setContactError(result.message);
      return;
    }
    await store({ ...profile, contacts: [...profile.contacts, result.contact] });
    setContactName("");
    setContactPhone("");
    setContactError(null);
    setAdding(false);
  }, [profile, contactName, contactPhone, store]);

  const invite = useCallback(
    async (id: string) => {
      if (!profile) return;
      const contact = profile.contacts.find((c) => c.id === id);
      if (!contact) return;
      if (!(await SMS.isAvailableAsync())) {
        setContactError("This phone cannot send text messages.");
        return;
      }
      await SMS.sendSMSAsync([contact.phone], inviteText(profile.personName));
      await store({
        ...profile,
        contacts: profile.contacts.map((c) => (c.id === id ? { ...c, invited: true } : c)),
      });
    },
    [profile, store],
  );

  const savePinForm = useCallback(async () => {
    if (!pinForm) return;
    const result = await setUpPins(
      { pin: pinForm.pin, duressPin: pinForm.duress },
      randomUUID(),
      sha256Hex,
    );
    if (!result.ok) {
      setPinMessage(result.message);
      return;
    }
    await savePins(AsyncStorage, result.pins);
    setPins(result.pins);
    setPinForm(null);
    setPinMessage("PIN saved. Remember it: Warden cannot show it to you again.");
  }, [pinForm]);

  if (!profile) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ModalHeader title="Safety contacts and PIN" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>Your name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={(value) => setName(value.slice(0, MAX_PERSON_NAME))}
          onEndEditing={() => void store({ ...profile, personName: name.trim() })}
          placeholder="How your contacts know you"
          placeholderTextColor={COLORS.muted}
          accessibilityLabel="Your name"
        />
        <Text style={styles.help}>Used in messages to your contacts, like "Ada needs help".</Text>

        <Text style={styles.section}>Trusted contacts</Text>
        {profile.contacts.map((contact) => (
          <View key={contact.id} style={styles.contactRow}>
            <Icon name="account" color={COLORS.primary} />
            <View style={styles.flex}>
              <Text style={styles.contactName}>{contact.name}</Text>
              <Text style={styles.help}>
                {displayPhone(contact.phone)}
                {contact.invited ? " · told" : ""}
              </Text>
            </View>
            {!contact.invited && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Tell ${contact.name}`}
                onPress={() => void invite(contact.id)}
                style={styles.smallButton}
              >
                <Text style={styles.smallButtonText}>Tell them</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${contact.name}`}
              onPress={() =>
                void store({
                  ...profile,
                  contacts: profile.contacts.filter((c) => c.id !== contact.id),
                })
              }
              style={styles.iconButton}
            >
              <Icon name="trash-can-outline" color={COLORS.muted} />
            </Pressable>
          </View>
        ))}

        {adding ? (
          <View style={styles.card}>
            <TextInput
              style={styles.input}
              value={contactName}
              onChangeText={setContactName}
              placeholder="Name"
              placeholderTextColor={COLORS.muted}
              accessibilityLabel="Contact name"
            />
            <TextInput
              style={styles.input}
              value={contactPhone}
              onChangeText={setContactPhone}
              placeholder="Phone, like 0803 123 4567"
              placeholderTextColor={COLORS.muted}
              keyboardType="phone-pad"
              accessibilityLabel="Contact phone number"
            />
            {contactError && <Text style={styles.error}>{contactError}</Text>}
            <Button
              label="Save contact"
              variant="primary"
              icon="check"
              onPress={() => void addContact()}
            />
            <Button label="Cancel" onPress={() => setAdding(false)} />
          </View>
        ) : profile.contacts.length < MAX_CONTACTS ? (
          <Button
            label="Add a trusted contact"
            icon="account-plus"
            variant={profile.contacts.length === 0 ? "primary" : "secondary"}
            onPress={() => setAdding(true)}
          />
        ) : null}
        {!adding && contactError && <Text style={styles.error}>{contactError}</Text>}
        <Note>
          Choose people you trust and tell them first ("Tell them" opens a text message from your
          phone). If you press SOS or are late arriving, Warden texts them a private link to your
          live location. Their numbers stay on this phone until then.
        </Note>

        <Text style={styles.section}>SOS</Text>
        <View style={styles.toggleRow}>
          <View style={styles.flex}>
            <Text style={styles.contactName}>Also alert responders near me</Text>
            <Text style={styles.help}>
              When you press SOS, verified responders (such as police or emergency services) in your
              area can see your name and live location until you are safe.
            </Text>
          </View>
          <Switch
            value={profile.shareSosWithResponders}
            onValueChange={(value) => void store({ ...profile, shareSosWithResponders: value })}
            accessibilityLabel="Also alert responders near me"
            trackColor={{ true: COLORS.primary }}
          />
        </View>

        <Text style={styles.section}>Safety PIN</Text>
        <Text style={styles.help}>
          {pins?.pinHash
            ? `PIN is set${pins.duressHash ? ", with a duress PIN" : ""}. You need it to stop a trip or SOS.`
            : "Without a PIN, anyone holding your phone can stop a trip or SOS."}
        </Text>
        {pinForm ? (
          <View style={styles.card}>
            <TextInput
              style={styles.input}
              value={pinForm.pin}
              onChangeText={(pin) =>
                setPinForm({ ...pinForm, pin: pin.replace(/\D/g, "").slice(0, 6) })
              }
              placeholder="PIN (4 to 6 digits)"
              placeholderTextColor={COLORS.muted}
              keyboardType="number-pad"
              secureTextEntry
              accessibilityLabel="PIN"
            />
            <TextInput
              style={styles.input}
              value={pinForm.duress}
              onChangeText={(duress) =>
                setPinForm({ ...pinForm, duress: duress.replace(/\D/g, "").slice(0, 6) })
              }
              placeholder="Duress PIN (optional)"
              placeholderTextColor={COLORS.muted}
              keyboardType="number-pad"
              secureTextEntry
              accessibilityLabel="Duress PIN"
            />
            <Text style={styles.help}>
              If someone forces you to stop, enter the duress PIN instead. Warden will look like it
              stopped, but your contacts get an urgent message.
            </Text>
            <Button
              label="Save PIN"
              variant="primary"
              icon="lock"
              onPress={() => void savePinForm()}
            />
            <Button label="Cancel" onPress={() => setPinForm(null)} />
          </View>
        ) : (
          <View style={styles.buttonRow}>
            <View style={styles.flex}>
              <Button
                label={pins?.pinHash ? "Change PIN" : "Set a PIN"}
                icon="lock"
                onPress={() => {
                  setPinMessage(null);
                  setPinForm({ pin: "", duress: "" });
                }}
              />
            </View>
            {pins?.pinHash && (
              <View style={styles.flex}>
                <Button
                  label="Remove PIN"
                  icon="lock-open-variant"
                  onPress={() => {
                    void savePins(AsyncStorage, null);
                    setPins(null);
                  }}
                />
              </View>
            )}
          </View>
        )}
        {pinMessage && <Text style={styles.help}>{pinMessage}</Text>}
        <Note tone="warning">
          Warden does not replace 112. In danger now, call 112 first if you can.
        </Note>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  body: { padding: 16, gap: 12, paddingBottom: 48 },
  section: { fontSize: 20, fontWeight: "700", color: COLORS.text, marginTop: 8 },
  help: { color: COLORS.muted },
  error: { color: COLORS.danger, fontWeight: "600" },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.surface,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: 12,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  contactName: { fontSize: 16, fontWeight: "600", color: COLORS.text },
  flex: { flex: 1 },
  smallButton: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    justifyContent: "center",
    backgroundColor: COLORS.primary,
  },
  smallButtonText: { color: COLORS.primaryText, fontWeight: "600" },
  iconButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  card: {
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  buttonRow: { flexDirection: "row", gap: 8 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
});
