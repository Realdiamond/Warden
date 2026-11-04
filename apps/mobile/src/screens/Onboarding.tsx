// First-run setup (M10): what Warden is, what stays private, location, trusted contacts, a safety
// PIN, home, and how SOS works. Everything is saved on the phone through the same stores the
// Safety and Places screens use, and every step except the welcome can be skipped.

import { Camera, Map as MapView } from "@maplibre/maplibre-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MAX_CONTACTS } from "@warden/shared";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import * as Location from "expo-location";
import * as SMS from "expo-sms";
import { type ReactNode, useEffect, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text, TextInput } from "../components/text.tsx";
import { useMapStyle, useStyles, useTheme } from "../components/theme.tsx";
import {
  Button,
  Card,
  Chip,
  Divider,
  EmergencyCallButton,
  Icon,
  IconTile,
  ListRow,
  Note,
  Steps,
  SwitchRow,
} from "../components/ui.tsx";
import { DEFAULT_ALERT_PREFS, loadAlertPrefs, saveAlertPrefs } from "../lib/alerts.ts";
import {
  displayPhone,
  inviteText,
  loadProfile,
  makeContact,
  type SafetyProfile,
  saveProfile,
} from "../lib/contacts.ts";
import { LANGUAGE_NAMES, LANGUAGES, type Language } from "../lib/i18n.ts";
import { currentPosition, type Position } from "../lib/location.ts";
import {
  NUMBERED_STEPS,
  nextStep,
  type OnboardingStep,
  pressKey,
  previousStep,
  SETUP_PIN_LENGTH,
} from "../lib/onboarding.ts";
import { savePins, setUpPins } from "../lib/pin.ts";
import {
  loadPlaces,
  PLACE_ICONS,
  PLACE_KIND_LABEL,
  type PlaceKind,
  savePlaces,
} from "../lib/places.ts";
import type { Settings } from "../lib/settings.ts";
import { MONO, type Palette } from "../lib/theme.ts";
import { PickLocation } from "./PickLocation.tsx";

const LAGOS: [number, number] = [3.37, 6.56];
const HOME_KINDS: PlaceKind[] = ["home", "work", "school", "family"];

const sha256Hex = (text: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text);

interface Props {
  settings: Settings;
  onLanguage: (language: Language) => void;
  onDone: () => void;
}

export function Onboarding({ settings, onLanguage, onDone }: Props) {
  const styles = useStyles(makeStyles);
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [picking, setPicking] = useState(false);
  const [profile, setProfile] = useState<SafetyProfile | null>(null);
  const [pinSet, setPinSet] = useState(false);
  const [home, setHome] = useState<{ kind: PlaceKind; position: Position } | null>(null);
  const [homeKind, setHomeKind] = useState<PlaceKind>("home");

  useEffect(() => {
    void loadProfile(AsyncStorage).then(setProfile);
  }, []);

  const go = (next: OnboardingStep) => setStep(next);
  const forward = () => go(nextStep(step));
  const number = NUMBERED_STEPS.indexOf(step);

  if (picking) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => setPicking(false)}
            style={styles.back}
          >
            <Icon name="chevron-left" size={28} />
          </Pressable>
          <Text style={styles.pickTitle}>Pick the place</Text>
        </View>
        <PickLocation
          start={home?.position ?? { lat: LAGOS[1], lng: LAGOS[0] }}
          hint={`Move the map so the pin is on your ${PLACE_KIND_LABEL[homeKind].toLowerCase()}.`}
          confirmLabel="Use this place"
          onPick={(point) => {
            setHome({ kind: homeKind, position: point });
            setPicking(false);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior="height">
        {number >= 0 && (
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={() => go(previousStep(step))}
              style={styles.back}
            >
              <Icon name="chevron-left" size={28} />
            </Pressable>
            <Steps current={number + 1} total={NUMBERED_STEPS.length} />
          </View>
        )}
        {step === "welcome" && (
          <Welcome settings={settings} onLanguage={onLanguage} onNext={forward} />
        )}
        {step === "privacy" && <Privacy onNext={forward} />}
        {step === "location" && <LocationStep onNext={forward} />}
        {step === "contacts" && profile && (
          <Contacts profile={profile} onChange={setProfile} onNext={forward} />
        )}
        {step === "pin" && <Pin onNext={forward} onSet={() => setPinSet(true)} pinSet={pinSet} />}
        {step === "home" && (
          <Home
            kind={homeKind}
            onKind={(kind) => {
              setHomeKind(kind);
              if (home) setHome({ ...home, kind });
            }}
            chosen={home?.position ?? null}
            onChosen={(position) => setHome({ kind: homeKind, position })}
            onPick={() => setPicking(true)}
            onNext={forward}
          />
        )}
        {step === "ready" && (
          <Ready
            name={profile?.personName ?? ""}
            contacts={profile?.contacts.map((contact) => contact.name) ?? []}
            pinSet={pinSet}
            home={home ? PLACE_KIND_LABEL[home.kind] : null}
            onDone={onDone}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** A step's scrolling content above its buttons. */
function StepLayout({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      <View style={styles.footer}>{footer}</View>
    </>
  );
}

function Title({ children, lead }: { children: string; lead?: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.titleBlock}>
      <Text style={styles.title} accessibilityRole="header">
        {children}
      </Text>
      {lead ? <Text style={styles.lead}>{lead}</Text> : null}
    </View>
  );
}

/** A still map for illustration; it cannot be moved. */
function StillMap({
  center,
  zoom,
  height,
  children,
}: {
  center: [number, number];
  zoom: number;
  height: number;
  children?: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const styleUrl = useMapStyle();
  return (
    <View style={[styles.stillMap, { height }]} pointerEvents="none" accessibilityElementsHidden>
      <MapView
        style={StyleSheet.absoluteFill}
        mapStyle={styleUrl}
        logo={false}
        compass={false}
        attribution={false}
        dragPan={false}
        touchZoom={false}
        touchRotate={false}
        touchPitch={false}
      >
        <Camera initialViewState={{ center, zoom }} />
      </MapView>
      {children}
    </View>
  );
}

function Marker({
  x,
  y,
  color,
  icon,
  size = 34,
}: {
  x: number;
  y: number;
  color: string;
  icon: string;
  size?: number;
}) {
  const c = useTheme();
  return (
    <View
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        borderWidth: 3,
        borderColor: c.name === "dark" ? c.background : "#FFFFFF",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={icon} size={size * 0.5} color="#FFFFFF" />
    </View>
  );
}

function YouDot({ x, y }: { x: number; y: number }) {
  const c = useTheme();
  return (
    <View style={{ position: "absolute", left: x - 22, top: y - 22, width: 44, height: 44 }}>
      <View
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 22,
          backgroundColor: c.user,
          opacity: 0.2,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 13,
          top: 13,
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: c.user,
          borderWidth: 3,
          borderColor: "#FFFFFF",
        }}
      />
    </View>
  );
}

function Welcome({
  settings,
  onLanguage,
  onNext,
}: {
  settings: Settings;
  onLanguage: (language: Language) => void;
  onNext: () => void;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <StepLayout
      footer={
        <>
          <Button label="Get started" variant="primary" icon="arrow-right" large onPress={onNext} />
          <EmergencyCallButton tone="soft" />
        </>
      }
    >
      <View style={styles.brandRow}>
        <View style={styles.logo}>
          <Icon name="shield-check" size={26} color={c.onPrimary} />
        </View>
        <Text style={styles.brand}>Warden</Text>
      </View>
      <StillMap center={LAGOS} zoom={12.2} height={210}>
        <Marker x={196} y={58} color={c.warning} icon="cellphone" />
        <Marker x={58} y={118} color={c.advisory} icon="car-side" size={30} />
        <Marker x={260} y={22} color={c.critical} icon="alert-octagon" />
        <YouDot x={160} y={128} />
      </StillMap>
      <Text style={styles.hero} accessibilityRole="header">
        Know what's happening around you. Get help fast.
      </Text>
      <View style={styles.promises}>
        <PromiseRow icon="map-marker-radius" text="A live safety map of your area" />
        <PromiseRow icon="incognito" text="Report in seconds, without your name" />
        <PromiseRow
          icon="account-heart"
          text="SOS straight to the people you trust"
          tone="danger"
        />
      </View>
      <View style={styles.languageRow} accessibilityLabel="Language">
        {LANGUAGES.map((language) => (
          <Chip
            key={language}
            label={LANGUAGE_NAMES[language]}
            selected={settings.language === language}
            onPress={() => onLanguage(language)}
          />
        ))}
      </View>
    </StepLayout>
  );
}

function PromiseRow({
  icon,
  text,
  tone = "primary",
}: {
  icon: string;
  text: string;
  tone?: "primary" | "danger";
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.promise}>
      <IconTile icon={icon} tone={tone} size={40} />
      <Text style={styles.promiseText}>{text}</Text>
    </View>
  );
}

function Privacy({ onNext }: { onNext: () => void }) {
  const styles = useStyles(makeStyles);
  return (
    <StepLayout footer={<Button label="Continue" variant="primary" large onPress={onNext} />}>
      <IconTile icon="eye-off-outline" size={72} />
      <Title lead="No sign-up. No name. No phone number.">Warden keeps you anonymous</Title>
      <Card>
        <ListRow
          icon="check"
          title="Reports never carry your name"
          description="Not even Warden's staff can see who sent one."
        />
        <Divider inset={66} />
        <ListRow
          icon="check"
          title="The map shows areas, not exact spots"
          description="Nobody can find a house or a person from it."
        />
        <Divider inset={66} />
        <ListRow
          icon="check"
          title="Your contacts and places stay on this phone"
          description="Warden's server never keeps your address book."
        />
      </Card>
      <Text style={styles.small}>
        Warden does not replace 112. In danger now, call 112 first if you can.
      </Text>
    </StepLayout>
  );
}

function LocationStep({ onNext }: { onNext: () => void }) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [busy, setBusy] = useState(false);
  const allow = async () => {
    setBusy(true);
    await Location.requestForegroundPermissionsAsync().catch(() => null);
    setBusy(false);
    onNext();
  };
  return (
    <StepLayout
      footer={
        <>
          <Button
            label={busy ? "Asking..." : "Use my location"}
            variant="primary"
            icon="crosshairs-gps"
            large
            disabled={busy}
            onPress={() => void allow()}
          />
          <Button label="Not now" variant="text" onPress={onNext} />
        </>
      }
    >
      <StillMap center={[3.3515, 6.6018]} zoom={14.6} height={230}>
        <View style={styles.ringWrap}>
          <View
            style={[styles.ring, { borderColor: c.primary, backgroundColor: `${c.primary}1F` }]}
          />
        </View>
        <YouDot x={171} y={115} />
      </StillMap>
      <Title lead="Warden opens the map where you are and helps you place a report. Your location stays on this phone.">
        Show what's near you
      </Title>
      <Note icon="shield-check-outline">
        Warden never tracks you in the background. It only shares your location when you start a
        trip or press SOS.
      </Note>
    </StepLayout>
  );
}

function Contacts({
  profile,
  onChange,
  onNext,
}: {
  profile: SafetyProfile;
  onChange: (profile: SafetyProfile) => void;
  onNext: () => void;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [adding, setAdding] = useState(profile.contacts.length === 0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const update = async (next: SafetyProfile) => {
    onChange(next);
    await saveProfile(AsyncStorage, next);
  };

  const add = async () => {
    const check = makeContact(profile.contacts, { id: randomUUID(), name, phone });
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setError(null);
    setName("");
    setPhone("");
    setAdding(false);
    await update({ ...profile, contacts: [...profile.contacts, check.contact] });
  };

  const tell = async (id: string) => {
    const contact = profile.contacts.find((item) => item.id === id);
    if (!contact) return;
    if (await SMS.isAvailableAsync().catch(() => false)) {
      await SMS.sendSMSAsync([contact.phone], inviteText(profile.personName)).catch(() => null);
    }
    await update({
      ...profile,
      contacts: profile.contacts.map((item) =>
        item.id === id ? { ...item, invited: true } : item,
      ),
    });
  };

  return (
    <StepLayout
      footer={
        <>
          <Button
            label="Continue"
            variant="primary"
            large
            disabled={profile.contacts.length === 0}
            onPress={onNext}
          />
          <Button label="I'll do this later" variant="text" onPress={onNext} />
        </>
      }
    >
      <Title lead="When you press SOS or don't arrive on time, Warden texts them a private link to your live location.">
        Who should we tell if you need help?
      </Title>
      <View style={styles.field}>
        <Text style={styles.label}>Your name, as they know you</Text>
        <TextInput
          style={styles.input}
          value={profile.personName}
          onChangeText={(value) => void update({ ...profile, personName: value.slice(0, 40) })}
          placeholder="For example: Ada"
          accessibilityLabel="Your name"
          autoCapitalize="words"
        />
      </View>
      <Card>
        {profile.contacts.map((contact, i) => (
          <View key={contact.id}>
            {i > 0 && <Divider inset={68} />}
            <View style={styles.contactRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{contact.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.contactName}>{contact.name}</Text>
                <Text style={styles.contactPhone}>{displayPhone(contact.phone)}</Text>
              </View>
              {contact.invited ? (
                <View style={styles.told}>
                  <Icon name="check" size={16} color={c.onPrimarySoft} />
                  <Text style={styles.toldText}>Told</Text>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Tell ${contact.name}`}
                  onPress={() => void tell(contact.id)}
                  style={styles.tellButton}
                >
                  <Text style={styles.tellText}>Tell them</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}
        {profile.contacts.length > 0 && <Divider inset={68} />}
        {adding ? (
          <View style={styles.addForm}>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Name"
              accessibilityLabel="Contact name"
              autoCapitalize="words"
            />
            <TextInput
              style={[styles.input, styles.mono]}
              value={phone}
              onChangeText={setPhone}
              placeholder="Phone, like 0803 123 4567"
              accessibilityLabel="Contact phone number"
              keyboardType="phone-pad"
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <Button
              label="Save contact"
              variant="primary"
              icon="check"
              onPress={() => void add()}
            />
          </View>
        ) : (
          profile.contacts.length < MAX_CONTACTS && (
            <ListRow
              icon="plus"
              title="Add a person"
              description={`Up to ${MAX_CONTACTS} people`}
              onPress={() => setAdding(true)}
            />
          )
        )}
      </Card>
      <Text style={styles.small}>
        "Tell them" opens a text from your own phone, so they know to expect Warden's message.
      </Text>
    </StepLayout>
  );
}

function Pin({
  onNext,
  onSet,
  pinSet,
}: {
  onNext: () => void;
  onSet: () => void;
  pinSet: boolean;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  type Stage = "pin" | "confirm" | "done" | "duress" | "duressConfirm" | "duressDone";
  const [stage, setStage] = useState<Stage>(pinSet ? "done" : "pin");
  const [value, setValue] = useState("");
  const [first, setFirst] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async (main: string, duress: string) => {
    const result = await setUpPins({ pin: main, duressPin: duress }, randomUUID(), sha256Hex);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    await savePins(AsyncStorage, result.pins);
    return true;
  };

  const press = async (key: string) => {
    const next = pressKey(value, key);
    setValue(next);
    if (next.length < SETUP_PIN_LENGTH) return;
    // A full PIN moves the stage on.
    if (stage === "pin" || stage === "duress") {
      setFirst(next);
      setValue("");
      setError(null);
      setStage(stage === "pin" ? "confirm" : "duressConfirm");
      return;
    }
    if (next !== first) {
      setError("The two PINs were different. Try again.");
      setValue("");
      setStage(stage === "confirm" ? "pin" : "duress");
      return;
    }
    if (stage === "confirm" && (await save(next, ""))) {
      setPin(next);
      setStage("done");
      onSet();
    }
    if (stage === "duressConfirm") {
      if (next === pin) {
        setError("The duress PIN must be different from your PIN.");
        setValue("");
        setStage("duress");
        return;
      }
      if (await save(pin, next)) setStage("duressDone");
    }
    setValue("");
  };

  const entering = stage !== "done" && stage !== "duressDone";
  const prompt =
    stage === "pin"
      ? "Choose 4 numbers you will remember."
      : stage === "confirm"
        ? "Enter the same 4 numbers again."
        : stage === "duress"
          ? "Choose a different 4-number PIN for when someone forces you to stop."
          : stage === "duressConfirm"
            ? "Enter the duress PIN again."
            : stage === "done"
              ? "PIN saved."
              : "PIN and duress PIN saved.";

  return (
    <StepLayout
      footer={
        <>
          {entering ? null : <Button label="Continue" variant="primary" large onPress={onNext} />}
          {entering && <Button label="I'll do this later" variant="text" onPress={onNext} />}
        </>
      }
    >
      <Title lead="You need it to stop an SOS or end a trip, so nobody can switch it off for you.">
        Set your safety PIN
      </Title>
      <Text style={[styles.prompt, !entering && { color: c.primary }]}>{prompt}</Text>
      {entering ? (
        <>
          <View
            style={styles.pinBoxes}
            accessible
            accessibilityLabel={`PIN, ${value.length} of ${SETUP_PIN_LENGTH} digits entered`}
          >
            {Array.from({ length: SETUP_PIN_LENGTH }, (_, i) => (
              <View
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed digit boxes
                key={i}
                style={[styles.pinBox, i === value.length && styles.pinBoxActive]}
              >
                {i < value.length ? <View style={styles.pinDot} /> : null}
              </View>
            ))}
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.keypad}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"].map((key) =>
              key === "" ? (
                <View key="blank" style={styles.key} />
              ) : (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={key === "back" ? "Delete last digit" : key}
                  onPress={() => void press(key)}
                  style={({ pressed }) => [
                    styles.key,
                    key !== "back" && styles.keyDigit,
                    pressed && styles.keyPressed,
                  ]}
                >
                  {key === "back" ? (
                    <Icon name="backspace-outline" size={26} />
                  ) : (
                    <Text style={styles.keyText}>{key}</Text>
                  )}
                </Pressable>
              ),
            )}
          </View>
        </>
      ) : (
        <Card>
          <ListRow icon="lock-check" title="Safety PIN" description="Set. Keep it to yourself." />
          <Divider inset={66} />
          {stage === "duressDone" ? (
            <ListRow
              icon="shield-alert-outline"
              tone="danger"
              title="Duress PIN"
              description="Set. Looks like a normal stop, but quietly warns your contacts."
            />
          ) : (
            <ListRow
              icon="shield-alert-outline"
              tone="danger"
              title="Add a duress PIN (optional)"
              description="If someone forces you to stop, it looks like a normal stop but quietly warns your contacts."
              onPress={() => {
                setError(null);
                setStage("duress");
              }}
            />
          )}
        </Card>
      )}
    </StepLayout>
  );
}

function Home({
  kind,
  onKind,
  chosen,
  onChosen,
  onPick,
  onNext,
}: {
  kind: PlaceKind;
  onKind: (kind: PlaceKind) => void;
  chosen: Position | null;
  onChosen: (position: Position) => void;
  onPick: () => void;
  onNext: () => void;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const [alertsOn, setAlertsOn] = useState(true);
  const [quiet, setQuiet] = useState(true);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const here = async () => {
    setLocating(true);
    const position = await currentPosition(10_000);
    setLocating(false);
    if (position) onChosen(position);
    else setMessage("Could not find your location. Choose the place on the map instead.");
  };

  const save = async () => {
    if (chosen) {
      const places = await loadPlaces(AsyncStorage);
      await savePlaces(AsyncStorage, [
        ...places,
        {
          id: randomUUID(),
          name: PLACE_KIND_LABEL[kind],
          kind,
          lat: chosen.lat,
          lng: chosen.lng,
        },
      ]);
    }
    const prefs = await loadAlertPrefs(AsyncStorage).catch(() => DEFAULT_ALERT_PREFS);
    await saveAlertPrefs(AsyncStorage, {
      ...prefs,
      enabled: alertsOn,
      quietHours: { enabled: quiet, startHour: 23, endHour: 6 },
    });
    onNext();
  };

  return (
    <StepLayout
      footer={
        <>
          <Button
            label={`Save ${PLACE_KIND_LABEL[kind].toLowerCase()}`}
            variant="primary"
            large
            disabled={!chosen}
            onPress={() => void save()}
          />
          <Button label="Skip for now" variant="text" onPress={onNext} />
        </>
      }
    >
      <Title lead="Get a warning when something serious happens near the places you care about.">
        Where's home?
      </Title>
      <View style={styles.chipRow}>
        {HOME_KINDS.map((item) => (
          <Chip
            key={item}
            label={PLACE_KIND_LABEL[item]}
            icon={PLACE_ICONS[item]}
            selected={kind === item}
            onPress={() => onKind(item)}
          />
        ))}
      </View>
      {chosen ? (
        <StillMap center={[chosen.lng, chosen.lat]} zoom={15.2} height={180}>
          <View style={styles.pinCenter}>
            <Icon name={PLACE_ICONS[kind]} size={20} color={c.onPrimary} />
          </View>
        </StillMap>
      ) : null}
      <View style={styles.choose}>
        <Button
          label={locating ? "Finding you..." : "Use where I am now"}
          icon="crosshairs-gps"
          disabled={locating}
          onPress={() => void here()}
        />
        <Button
          label={chosen ? "Change on the map" : "Choose on the map"}
          icon="map-marker-radius"
          onPress={onPick}
        />
      </View>
      {message && <Note tone="warning">{message}</Note>}
      <Card>
        <SwitchRow
          title="Warn me about serious incidents"
          description="Within about 2 km of this place"
          value={alertsOn}
          onValueChange={setAlertsOn}
        />
        <Divider />
        <SwitchRow
          title="Quiet at night"
          description="11 pm to 6 am. Emergencies still ring."
          value={quiet}
          onValueChange={setQuiet}
        />
      </Card>
    </StepLayout>
  );
}

function Ready({
  name,
  contacts,
  pinSet,
  home,
  onDone,
}: {
  name: string;
  contacts: string[];
  pinSet: boolean;
  home: string | null;
  onDone: () => void;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const who =
    contacts.length === 0
      ? null
      : contacts.length === 1
        ? contacts[0]
        : `${contacts.slice(0, -1).join(", ")} and ${contacts[contacts.length - 1]}`;
  return (
    <StepLayout
      footer={
        <>
          <Button
            label="Open the map"
            variant="primary"
            icon="arrow-right"
            large
            onPress={onDone}
          />
          <Text style={styles.smallCenter}>You can change any of this later in Menu.</Text>
        </>
      }
    >
      <View style={styles.readyMark}>
        <Icon name="check" size={40} color={c.onPrimary} />
      </View>
      <Title>{name.trim() ? `You're set, ${name.trim()}` : "You're set"}</Title>
      <Card>
        <ReadyRow
          done={contacts.length > 0}
          title={
            contacts.length > 0
              ? `${contacts.length} trusted ${contacts.length === 1 ? "contact" : "contacts"}`
              : "No trusted contacts yet"
          }
          description={who ?? "Add them in Menu so SOS can alert someone."}
        />
        <Divider inset={50} />
        <ReadyRow
          done={pinSet}
          title={pinSet ? "Safety PIN" : "No safety PIN yet"}
          description={pinSet ? "Needed to stop an SOS or a trip" : "You can set one in Menu."}
        />
        <Divider inset={50} />
        <ReadyRow
          done={home !== null}
          title={home ? `Alerts near ${home}` : "No places saved yet"}
          description={
            home ? "Quiet at night, except emergencies" : "Add them in Menu, Alerts and places."
          }
        />
      </Card>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        How SOS works
      </Text>
      <View style={styles.how}>
        <View style={styles.howRow}>
          <View style={styles.howSos}>
            <Text style={styles.howSosText}>SOS</Text>
          </View>
          <Text style={styles.howText}>Press the red SOS button on the map</Text>
        </View>
        <View style={styles.howRow}>
          <View style={styles.howFive}>
            <Text style={styles.howFiveText}>5</Text>
          </View>
          <Text style={styles.howText}>You have 5 seconds to cancel if it was a mistake</Text>
        </View>
        <View style={styles.howRow}>
          <IconTile icon="account-heart" size={44} round />
          <Text style={styles.howText}>
            {who
              ? `${who} get a text with your live location`
              : "Your contacts get a text with your live location"}
          </Text>
        </View>
      </View>
    </StepLayout>
  );
}

function ReadyRow({
  done,
  title,
  description,
}: {
  done: boolean;
  title: string;
  description: string;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.readyRow}>
      <Icon
        name={done ? "check-circle" : "circle-outline"}
        size={24}
        color={done ? c.primary : c.faint}
      />
      <View style={styles.flex}>
        <Text style={styles.readyTitle}>{title}</Text>
        <Text style={styles.readyDescription}>{description}</Text>
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 4,
    },
    back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    pickTitle: { fontSize: 22, fontWeight: "800", color: c.text },
    body: { padding: 24, paddingTop: 16, gap: 20 },
    footer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20, gap: 6 },
    titleBlock: { gap: 10 },
    title: { fontSize: 30, lineHeight: 34, fontWeight: "800", color: c.text },
    lead: { fontSize: 17, lineHeight: 24, color: c.muted },
    hero: { fontSize: 30, lineHeight: 34, fontWeight: "800", color: c.text },
    brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    logo: {
      width: 44,
      height: 44,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.primary,
    },
    brand: { fontSize: 24, fontWeight: "800", color: c.text },
    stillMap: {
      borderRadius: 22,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceMuted,
    },
    promises: { gap: 14 },
    promise: { flexDirection: "row", alignItems: "center", gap: 14 },
    promiseText: { flex: 1, fontSize: 17, lineHeight: 22, color: c.text },
    languageRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    small: { fontSize: 15, lineHeight: 21, color: c.muted },
    smallCenter: { fontSize: 14, color: c.muted, textAlign: "center" },
    ringWrap: {
      position: "absolute",
      inset: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    ring: {
      width: 180,
      height: 180,
      borderRadius: 90,
      borderWidth: 2,
      borderStyle: "dashed",
    },
    field: { gap: 8 },
    label: { fontSize: 15, fontWeight: "700", color: c.text },
    input: {
      minHeight: 52,
      paddingHorizontal: 16,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.borderStrong,
      backgroundColor: c.surface,
      fontSize: 17,
      color: c.text,
    },
    mono: { fontFamily: MONO },
    error: { fontSize: 15, color: c.dangerText, fontWeight: "700" },
    contactRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
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
    contactPhone: { fontSize: 14, fontFamily: MONO, color: c.muted },
    told: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minHeight: 32,
      paddingHorizontal: 12,
      borderRadius: 16,
      backgroundColor: c.primarySoft,
    },
    toldText: { fontSize: 14, fontWeight: "700", color: c.onPrimarySoft },
    tellButton: {
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.primary,
    },
    tellText: { fontSize: 15, fontWeight: "700", color: c.onPrimary },
    addForm: { padding: 14, gap: 10 },
    prompt: { fontSize: 16, fontWeight: "700", color: c.text },
    pinBoxes: { flexDirection: "row", gap: 12, paddingHorizontal: 24 },
    pinBox: {
      flex: 1,
      height: 64,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: c.borderStrong,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    pinBoxActive: { borderColor: c.primary },
    pinDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: c.text },
    keypad: { flexDirection: "row", flexWrap: "wrap", rowGap: 10, columnGap: 10 },
    key: {
      width: "31%",
      flexGrow: 1,
      height: 58,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    keyDigit: {
      backgroundColor: c.surface,
      borderWidth: c.name === "dark" ? 1 : 0,
      borderColor: c.border,
    },
    keyPressed: { backgroundColor: c.primarySoft },
    keyText: { fontSize: 26, fontFamily: MONO, color: c.text },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    pinCenter: {
      position: "absolute",
      left: "50%",
      top: "50%",
      marginLeft: -20,
      marginTop: -20,
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.primary,
      borderWidth: 3,
      borderColor: "#FFFFFF",
    },
    choose: { gap: 10 },
    readyMark: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.primary,
    },
    readyRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    readyTitle: { fontSize: 16, fontWeight: "700", color: c.text },
    readyDescription: { fontSize: 14, color: c.muted },
    sectionTitle: { fontSize: 20, fontWeight: "800", color: c.text },
    how: { gap: 14 },
    howRow: { flexDirection: "row", alignItems: "center", gap: 14 },
    howText: { flex: 1, fontSize: 16, lineHeight: 22, color: c.text },
    howSos: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.danger,
    },
    howSosText: { fontSize: 13, fontWeight: "800", color: c.onDanger },
    howFive: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: c.dangerText,
    },
    howFiveText: { fontSize: 18, fontFamily: MONO, fontWeight: "700", color: c.dangerText },
  });
