import AsyncStorage from "@react-native-async-storage/async-storage";
import { MAX_CONTACTS, MAX_PERSON_NAME } from "@warden/shared";
import { requestRecordingPermissionsAsync } from "expo-audio";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import * as SMS from "expo-sms";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text, TextInput } from "../components/text.tsx";
import { useStyles, useTheme } from "../components/theme.tsx";
import {
  Button,
  Card,
  Divider,
  Icon,
  IconTile,
  ModalHeader,
  Note,
  SectionLabel,
  SwitchRow,
} from "../components/ui.tsx";
import {
  displayPhone,
  inviteText,
  loadProfile,
  makeContact,
  type SafetyProfile,
  saveProfile,
} from "../lib/contacts.ts";
import { loadPins, type PinSettings, savePins, setUpPins } from "../lib/pin.ts";
import { MONO, type Palette } from "../lib/theme.ts";

export const sha256Hex = (text: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text);

export function SafetyScreen({ onClose }: { onClose: () => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
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

  const [micMessage, setMicMessage] = useState<string | null>(null);

  const store = useCallback(async (next: SafetyProfile) => {
    setProfile(next);
    await saveProfile(AsyncStorage, next);
  }, []);

  const setSosSound = useCallback(
    async (on: boolean) => {
      if (!profile) return;
      setMicMessage(null);
      if (on) {
        const permission = await requestRecordingPermissionsAsync().catch(() => null);
        if (!permission?.granted) {
          setMicMessage("Warden needs the microphone for this. Allow it in your phone's settings.");
          return;
        }
      }
      await store({ ...profile, recordSosSound: on });
    },
    [profile, store],
  );

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
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ModalHeader title="Safety contacts and PIN" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <SectionLabel>Your name</SectionLabel>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(value) => setName(value.slice(0, MAX_PERSON_NAME))}
            onEndEditing={() => void store({ ...profile, personName: name.trim() })}
            placeholder="How your contacts know you"
            accessibilityLabel="Your name"
          />
          <Text style={styles.help}>Used in messages to your contacts, like "Ada needs help".</Text>
        </View>

        <View style={styles.section}>
          <SectionLabel>Trusted contacts</SectionLabel>
          {profile.contacts.length > 0 && (
            <Card>
              {profile.contacts.map((contact, index) => (
                <View key={contact.id}>
                  {index > 0 && <Divider inset={72} />}
                  <View style={styles.contactRow}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {contact.name.trim().charAt(0).toUpperCase() || "?"}
                      </Text>
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.contactName}>{contact.name}</Text>
                      <Text style={styles.phone}>{displayPhone(contact.phone)}</Text>
                    </View>
                    {contact.invited ? (
                      <View style={styles.toldPill}>
                        <Icon name="check" size={16} color={c.onPrimarySoft} />
                        <Text style={styles.toldText}>Told</Text>
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Tell ${contact.name}`}
                        onPress={() => void invite(contact.id)}
                        style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}
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
                      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                    >
                      <Icon name="trash-can-outline" color={c.muted} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </Card>
          )}

          {adding ? (
            <Card style={styles.form}>
              <TextInput
                style={styles.input}
                value={contactName}
                onChangeText={setContactName}
                placeholder="Name"
                accessibilityLabel="Contact name"
              />
              <TextInput
                style={[styles.input, styles.mono]}
                value={contactPhone}
                onChangeText={setContactPhone}
                placeholder="Phone, like 0803 123 4567"
                keyboardType="phone-pad"
                accessibilityLabel="Contact phone number"
              />
              {contactError && <Text style={styles.error}>{contactError}</Text>}
              <Button
                label="Save contact"
                variant="primary"
                icon="check"
                large
                onPress={() => void addContact()}
              />
              <Button label="Cancel" variant="text" onPress={() => setAdding(false)} />
            </Card>
          ) : profile.contacts.length < MAX_CONTACTS ? (
            <Button
              label="Add a trusted contact"
              icon="account-plus"
              variant={profile.contacts.length === 0 ? "primary" : "secondary"}
              onPress={() => setAdding(true)}
            />
          ) : null}
          {!adding && contactError && <Text style={styles.error}>{contactError}</Text>}
          <Note icon="account-heart-outline">
            Choose people you trust and tell them first ("Tell them" opens a text message from your
            phone). If you press SOS or are late arriving, Warden texts them a private link to your
            live location. Their numbers stay on this phone until then.
          </Note>
        </View>

        <View style={styles.section}>
          <SectionLabel>SOS</SectionLabel>
          <Card>
            <SwitchRow
              title="Also alert responders near me"
              description="When you press SOS, verified responders (such as police or emergency services) in your area can see your name and live location until you are safe."
              value={profile.shareSosWithResponders}
              onValueChange={(value) => void store({ ...profile, shareSosWithResponders: value })}
            />
            <Divider />
            <SwitchRow
              title="Record sound during SOS"
              description={
                'When you press SOS, your phone records sound in short clips and sends them to Warden, so your contacts can hear what is happening on their private link. Android shows a "recording" notice while it runs. Clips are deleted after 30 days.'
              }
              value={profile.recordSosSound}
              onValueChange={(value) => void setSosSound(value)}
            />
          </Card>
          {micMessage && <Text style={styles.error}>{micMessage}</Text>}
        </View>

        <View style={styles.section}>
          <SectionLabel>Safety PIN</SectionLabel>
          <Card style={styles.pinCard}>
            <View style={styles.pinStatus}>
              <IconTile
                icon={pins?.pinHash ? "lock-check" : "lock-open-alert"}
                tone={pins?.pinHash ? "primary" : "warning"}
                size={40}
              />
              <Text style={styles.pinText}>
                {pins?.pinHash
                  ? `PIN is set${pins.duressHash ? ", with a duress PIN" : ""}. You need it to stop a trip or SOS.`
                  : "Without a PIN, anyone holding your phone can stop a trip or SOS."}
              </Text>
            </View>
            {pinForm ? (
              <View style={styles.form}>
                <TextInput
                  style={[styles.input, styles.mono]}
                  value={pinForm.pin}
                  onChangeText={(pin) =>
                    setPinForm({ ...pinForm, pin: pin.replace(/\D/g, "").slice(0, 6) })
                  }
                  placeholder="PIN (4 to 6 digits)"
                  keyboardType="number-pad"
                  secureTextEntry
                  accessibilityLabel="PIN"
                />
                <TextInput
                  style={[styles.input, styles.mono]}
                  value={pinForm.duress}
                  onChangeText={(duress) =>
                    setPinForm({ ...pinForm, duress: duress.replace(/\D/g, "").slice(0, 6) })
                  }
                  placeholder="Duress PIN (optional)"
                  keyboardType="number-pad"
                  secureTextEntry
                  accessibilityLabel="Duress PIN"
                />
                <Text style={styles.help}>
                  If someone forces you to stop, enter the duress PIN instead. Warden will look like
                  it stopped, but your contacts get an urgent message.
                </Text>
                <Button
                  label="Save PIN"
                  variant="primary"
                  icon="lock"
                  large
                  onPress={() => void savePinForm()}
                />
                <Button label="Cancel" variant="text" onPress={() => setPinForm(null)} />
              </View>
            ) : (
              <View style={styles.buttonRow}>
                <View style={styles.flex}>
                  <Button
                    label={pins?.pinHash ? "Change PIN" : "Set a PIN"}
                    icon="lock"
                    variant={pins?.pinHash ? "secondary" : "primary"}
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
          </Card>
          {pinMessage && <Text style={styles.help}>{pinMessage}</Text>}
        </View>

        <Note tone="warning">
          Warden does not replace 112. In danger now, call 112 first if you can.
        </Note>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    center: { alignItems: "center", justifyContent: "center" },
    body: { padding: 16, gap: 20, paddingBottom: 48 },
    section: { gap: 10 },
    help: { color: c.muted, fontSize: 14, lineHeight: 20 },
    error: { color: c.dangerText, fontWeight: "700", fontSize: 14 },
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
    mono: { fontFamily: MONO },
    contactRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 68,
      paddingLeft: 14,
      paddingRight: 4,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.primarySoft,
    },
    avatarText: { fontSize: 18, fontWeight: "800", color: c.onPrimarySoft },
    contactName: { fontSize: 17, fontWeight: "700", color: c.text },
    phone: { fontFamily: MONO, fontSize: 14, color: c.muted },
    flex: { flex: 1 },
    toldPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minHeight: 32,
      paddingHorizontal: 12,
      borderRadius: 16,
      backgroundColor: c.primarySoft,
    },
    toldText: { color: c.onPrimarySoft, fontWeight: "700", fontSize: 14 },
    smallButton: {
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 22,
      justifyContent: "center",
      backgroundColor: c.primary,
    },
    smallButtonText: { color: c.onPrimary, fontWeight: "700", fontSize: 15 },
    iconButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
    pressed: { opacity: 0.6 },
    form: { gap: 10, padding: 16 },
    pinCard: { padding: 16, gap: 14 },
    pinStatus: { flexDirection: "row", alignItems: "center", gap: 12 },
    pinText: { flex: 1, fontSize: 15, lineHeight: 21, color: c.text },
    buttonRow: { flexDirection: "row", gap: 8 },
  });
