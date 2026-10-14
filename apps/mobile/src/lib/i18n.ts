// The app's words in English and Nigerian Pidgin (M6).
//
// The Pidgin text is a DRAFT written without a native speaker. It must be checked by one before
// launch (docs/milestones.md). It covers what matters most when someone is in danger: alerts
// (shown and spoken), SOS and trips, the "Are you OK?" check, reporting, safe places and the main
// screen. Other screens are still English.
//
// Speech uses the Nigerian English voice for both, since phones have no Pidgin voice.

import type { CategoryId } from "@warden/shared";

export const LANGUAGES = ["en", "pcm"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  pcm: "Pidgin (draft)",
};

export interface Strings {
  // Alerts
  danger: (what: string) => string;
  warning: (what: string) => string;
  over: (what: string) => string;
  update: (what: string) => string;
  verifiedTitle: (what: string) => string;
  messageFrom: (who: string) => string;
  aResponder: string;
  incident: string;
  near: (place: string, distance: string) => string;
  aboutMeters: (m: number) => string;
  aboutKm: (km: string) => string;
  justNow: string;
  minAgo: (n: number) => string;
  hoursAgo: (n: number) => string;
  reportedOver: string;
  beingChecked: string;
  confirmed: string;
  corroborated: string;
  oneReport: string;
  demoNotReal: string;
  notVerified: string;
  covers: (place: string) => string;
  moreAlerts: (n: number) => string;
  openToSee: string;
  // SOS and trips
  sosShare: (link: string) => string;
  tripShare: (link: string, name: string) => string;
  sosOn: string;
  sharingTrip: string;
  contactsAlerted: string;
  sharingUntilSafe: string;
  late: (n: number) => string;
  expectedBy: (time: string) => string;
  minLeft: (n: number, place: string | null) => string;
  toldLate: string;
  addTimeOr: string;
  waitingForSignal: (n: number) => string;
  demoNoAlert: string;
  textContactsNow: string;
  sendLink: string;
  shareOtherWay: string;
  imSafe: string;
  arrived: string;
  cancelTrip: string;
  noContacts: string;
  enterPin: string;
  enterPinToStop: string;
  enterPinToAnswer: string;
  wrongPin: string;
  stop: string;
  stopping: string;
  sendingSos: string;
  sosWillSend: string;
  sendNow: string;
  cancel: string;
  // Off-route check
  areYouOk: string;
  awayFromRoute: (place: string | null) => string;
  imOk: string;
  contactsToldIn: (minutes: number) => string;
  contactsTold: string;
  // Safe places
  safePlaces: string;
  safePlacesHelp: string;
  noSafePlaces: string;
  directions: string;
  open24h: string;
  notChecked: string;
  noMapsApp: (name: string, where: string) => string;
  // Reporting and support
  thankYouPrivate: string;
  privateHelp: string;
  supportBeingConfirmed: string;
  call: (number: string) => string;
  // Main screen
  report: string;
  sos: string;
  safety: string;
  alerts: string;
  call112: string;
}

const en: Strings = {
  danger: (w) => `Danger: ${w}`,
  warning: (w) => `Warning: ${w}`,
  over: (w) => `Over: ${w}`,
  update: (w) => `Update: ${w}`,
  verifiedTitle: (w) => `Verified: ${w}`,
  messageFrom: (who) => `Message from ${who}`,
  aResponder: "a responder",
  incident: "Incident",
  near: (place, distance) => `Near ${place} (${distance})`,
  aboutMeters: (m) => `about ${m} m`,
  aboutKm: (km) => `about ${km} km`,
  justNow: "just now",
  minAgo: (n) => `${n} min ago`,
  hoursAgo: (n) => `${n} h ago`,
  reportedOver: "Reported as over.",
  beingChecked: "Some people say this is wrong. Being checked.",
  confirmed: "Confirmed.",
  corroborated: "Reported by more than one person.",
  oneReport: "One report, not yet confirmed.",
  demoNotReal: "Demo, not real. ",
  notVerified: " (not verified)",
  covers: (place) => ` · Covers ${place}`,
  moreAlerts: (n) => `${n} more alerts near your places`,
  openToSee: "Open Warden to see them.",
  sosShare: (link) =>
    `SOS: I need help. My live location:${link} If you cannot reach me, call 112.`,
  tripShare: (link, name) =>
    `I'm sharing my trip with you on Warden. Follow my live location:${link}${name ? ` - ${name}` : ""}`,
  sosOn: "SOS is on",
  sharingTrip: "Sharing your trip",
  contactsAlerted: "Your trusted contacts are being alerted",
  sharingUntilSafe: "Warden is sharing your live location with them until you say you are safe.",
  late: (n) => `You are ${n} min late`,
  expectedBy: (t) => `Expected by ${t}`,
  minLeft: (n, place) => `${n} min left${place ? ` to ${place}` : ""}.`,
  toldLate: "Your contacts have been told you are late. Add time or say you have arrived.",
  addTimeOr: "Add time or say you have arrived, or your contacts will be told.",
  waitingForSignal: (n) => `${n} location update(s) waiting for signal.`,
  demoNoAlert: "Demo mode: no one was alerted and no link was made.",
  textContactsNow: "Text my contacts now",
  sendLink: "Send the link to my contacts",
  shareOtherWay: "Share the link another way",
  imSafe: "I'm safe now",
  arrived: "I've arrived",
  cancelTrip: "Cancel trip",
  noContacts:
    "You have no trusted contacts, so Warden cannot alert anyone. Call 112, or share the link with someone you trust.",
  enterPin: "Enter your PIN",
  enterPinToStop: "Enter your Warden PIN to stop sharing.",
  enterPinToAnswer: "Enter your Warden PIN to say you are OK.",
  wrongPin: "Wrong PIN. Try again.",
  stop: "Stop",
  stopping: "Stopping...",
  sendingSos: "Sending SOS",
  sosWillSend: "Your trusted contacts will get your live location. Then you can call 112.",
  sendNow: "Send now",
  cancel: "Cancel",
  areYouOk: "Are you OK?",
  awayFromRoute: (place) => `You seem to be moving away from ${place ?? "where you are going"}.`,
  imOk: "I'm OK",
  contactsToldIn: (m) => `If you do not answer, your contacts will be told in ${m} min.`,
  contactsTold: "Your contacts were told you left your route. Answer to let them know you are OK.",
  safePlaces: "Safe places near you",
  safePlacesHelp: "Police stations, hospitals and other places that are open to the public.",
  noSafePlaces: "No safe places are listed near here yet.",
  directions: "Directions",
  open24h: "Open 24 hours",
  notChecked: "Not yet checked by Warden",
  noMapsApp: (name, where) => `No maps app could open this. ${name} is at ${where}.`,
  thankYouPrivate: "Thank you for telling us",
  privateHelp:
    "This report stays private. It never appears on the map. If you or someone else is in danger now, call 112.",
  supportBeingConfirmed:
    "Warden is confirming support services (counselling, medical and legal help) for your area. They will be listed here.",
  call: (n) => `Call ${n}`,
  report: "Report",
  sos: "SOS",
  safety: "Safety",
  alerts: "Alerts",
  call112: "Call 112",
};

// DRAFT Pidgin: needs checking by a native speaker before launch.
const pcm: Strings = {
  danger: (w) => `Danger: ${w}`,
  warning: (w) => `Make you shine eye: ${w}`,
  over: (w) => `E don end: ${w}`,
  update: (w) => `New tori: ${w}`,
  verifiedTitle: (w) => `E don confirm: ${w}`,
  messageFrom: (who) => `Message from ${who}`,
  aResponder: "people wey dey respond",
  incident: "Wahala",
  near: (place, distance) => `Near ${place} (${distance})`,
  aboutMeters: (m) => `like ${m} m`,
  aboutKm: (km) => `like ${km} km`,
  justNow: "just now",
  minAgo: (n) => `${n} min wey don pass`,
  hoursAgo: (n) => `${n} hour wey don pass`,
  reportedOver: "People talk say e don end.",
  beingChecked: "Some people talk say no be true. We dey check am.",
  confirmed: "E don confirm.",
  corroborated: "Pass one person don report am.",
  oneReport: "Na only one person report am, we never confirm.",
  demoNotReal: "Na demo, no be real. ",
  notVerified: " (we never check am)",
  covers: (place) => ` · E reach ${place}`,
  moreAlerts: (n) => `${n} more alert near your places`,
  openToSee: "Open Warden make you see dem.",
  sosShare: (link) =>
    `SOS: I need help. See where I dey now:${link} If you no fit reach me, call 112.`,
  tripShare: (link, name) =>
    `I dey share my journey with you for Warden. Follow where I dey:${link}${name ? ` - ${name}` : ""}`,
  sosOn: "SOS don on",
  sharingTrip: "You dey share your journey",
  contactsAlerted: "We dey alert the people wey you trust",
  sharingUntilSafe: "Warden go dey show dem where you dey until you talk say you dey safe.",
  late: (n) => `You don late reach ${n} min`,
  expectedBy: (t) => `You suppose reach by ${t}`,
  minLeft: (n, place) => `${n} min remain${place ? ` to reach ${place}` : ""}.`,
  toldLate: "We don tell your people say you late. Add time or talk say you don reach.",
  addTimeOr: "Add time or talk say you don reach, or we go tell your people.",
  waitingForSignal: (n) => `${n} location update dey wait for network.`,
  demoNoAlert: "Demo mode: we no alert anybody, no link.",
  textContactsNow: "Text my people now",
  sendLink: "Send the link give my people",
  shareOtherWay: "Share the link another way",
  imSafe: "I don dey safe",
  arrived: "I don reach",
  cancelTrip: "Cancel the journey",
  noContacts:
    "You never add people wey you trust, so Warden no fit alert anybody. Call 112, or share the link with person wey you trust.",
  enterPin: "Put your PIN",
  enterPinToStop: "Put your Warden PIN make e stop to dey share.",
  enterPinToAnswer: "Put your Warden PIN to talk say you dey OK.",
  wrongPin: "PIN no correct. Try again.",
  stop: "Stop am",
  stopping: "E dey stop...",
  sendingSos: "SOS dey go",
  sosWillSend: "The people wey you trust go see where you dey. After that you fit call 112.",
  sendNow: "Send am now",
  cancel: "Cancel am",
  areYouOk: "You dey OK?",
  awayFromRoute: (place) =>
    `E be like say you dey comot from the road wey go ${place ?? "where you dey go"}.`,
  imOk: "I dey OK",
  contactsToldIn: (m) => `If you no answer, we go tell your people in ${m} min.`,
  contactsTold:
    "We don tell your people say you comot from your road. Answer make dem know say you dey OK.",
  safePlaces: "Safe places wey near you",
  safePlacesHelp: "Police station, hospital and other places wey everybody fit enter.",
  noSafePlaces: "We never get safe places for this area yet.",
  directions: "Show me road",
  open24h: "E dey open 24 hours",
  notChecked: "Warden never check am",
  noMapsApp: (name, where) => `Map app no fit open am. ${name} dey for ${where}.`,
  thankYouPrivate: "Thank you say you tell us",
  privateHelp:
    "This report go remain private. E no go show for map. If you or another person dey danger now, call 112.",
  supportBeingConfirmed:
    "Warden dey confirm people wey fit help (counselling, hospital and legal help) for your area. We go put dem here.",
  call: (n) => `Call ${n}`,
  report: "Report",
  sos: "SOS",
  safety: "Safety",
  alerts: "Alert",
  call112: "Call 112",
};

const STRINGS: Record<Language, Strings> = { en, pcm };

export function strings(language: Language | undefined): Strings {
  return STRINGS[language ?? "en"] ?? en;
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/** Category names in Pidgin (draft); English falls back to the shared labels. */
const PIDGIN_CATEGORIES: Partial<Record<CategoryId, string>> = {
  armed_robbery: "Armed robbery",
  kidnapping: "Kidnapping",
  assault: "Fight or attack",
  shooting: "Shooting",
  killing: "Dem kill person",
  cult_clash: "Cult fight",
  bandit_attack: "Bandit attack",
  theft: "Thief",
  burglary: "Dem break house",
  phone_snatching: "Phone snatching",
  vehicle_theft: "Dem steal motor",
  one_chance: '"One chance" for motor',
  crash: "Accident",
  hit_and_run: "Motor jam person run",
  road_blockage: "Road block",
  fake_checkpoint: "Fake checkpoint",
  dangerous_driving: "Bad driving",
  fake_officials: "Fake officer",
  pos_fraud: "POS wayo",
  scam_calls: "Scam call",
  protest: "Protest or crowd",
  riot: "Riot",
  communal_clash: "Community fight",
  gunfire_heard: "Gunshot sound",
  explosion: "Explosion",
  fire: "Fire",
  flood: "Flood",
  building_collapse: "House don fall",
  tanker_incident: "Tanker wahala",
  gas_leak: "Gas dey leak",
  live_wire: "Wire wey get current don fall",
  sexual_violence: "Sexual violence",
  domestic_violence: "Wahala for house (domestic violence)",
  missing_person: "Person wey miss",
  suspicious_behaviour: "Person wey dey act somehow",
};

export function categoryName(id: string, english: string, language: Language | undefined): string {
  if (language === "pcm") return PIDGIN_CATEGORIES[id as CategoryId] ?? english;
  return english;
}

/** The voice used for spoken alerts. */
export function speechLanguage(_language: Language | undefined): string {
  return "en-NG";
}
