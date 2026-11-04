// The app's words in English and Nigerian Pidgin (M6).
//
// The Pidgin text is a DRAFT written without a native speaker. It must be checked by one before
// launch (docs/milestones.md). It covers what matters most when someone is in danger: alerts
// (shown and spoken), SOS and trips, the "Are you OK?" check, reporting, safe places and the main
// screen. Other screens are still English.
//
// Speech uses the Nigerian English voice for both, since phones have no Pidgin voice.

import type { CategoryId, TimeWindow } from "@warden/shared";

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
  // Community feed
  community: string;
  communityHelp: string;
  noPosts: string;
  wardenTeam: string;
  anonymousTip: string;
  shareTip: string;
  tipPlaceholder: string;
  tipRules: string;
  sendTip: string;
  tipSent: string;
  flag: string;
  flagged: string;
  // Route safety
  routeCalm: string;
  routeCaution: string;
  routeAvoid: string;
  routeBasis: (n: number) => string;
  routeNothing: string;
  // Main screen
  report: string;
  sos: string;
  safety: string;
  alerts: string;
  call112: string;
  trip: string;
  menu: string;
  // Map summary (M10)
  nearYou: string;
  inThisArea: string;
  dangerNearby: string;
  takeCareNearby: string;
  quietNearYou: string;
  quietTonight: string;
  reportsWithin: (n: number, km: number, window: string) => string;
  reportsInView: (n: number, window: string) => string;
  tapCircle: string;
  lastWindow: Record<TimeWindow, string>;
  emergencyKey: string;
  warningKey: string;
  advisoryKey: string;
  respondersKey: string;
  // Report, trip and SOS screens (M10)
  stepOf: (n: number, total: number) => string;
  whatsHappening: string;
  call112First: string;
  privateGroupNote: string;
  privateShort: string;
  anonymousNoName: string;
  whichOne: (group: string) => string;
  whereDidItHappen: string;
  whereIAmNow: string;
  chooseOnMap: string;
  locationStaysHere: string;
  noLocation: string;
  privateOnlyStaff: string;
  anythingElse: string;
  describePlaceholder: string;
  noNames: string;
  sendReport: string;
  backToMap: string;
  howLong: string;
  lateHelp: string;
  whereTo: string;
  pickOnMap: string;
  placeOnMap: string;
  whereGoing: string;
  moveToDestination: string;
  noteForContacts: string;
  notePlaceholder: string;
  noContactsTrip: string;
  addContacts: string;
  startSharing: string;
  starting: string;
  tripPrivacy: string;
  shareMyTrip: string;
  sharingLive: string;
  whoIsTold: string;
  getsText: string;
  respondersNear: string;
  respondersCanSee: string;
  needsPin: string;
  willGetLocation: (names: string) => string;
  and: string;
  seconds: string;
  pressedByMistake: string;
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
  community: "Community",
  communityHelp: "Tips from people nearby, checked by Warden before they appear, and notices.",
  noPosts: "Nothing posted for this area yet.",
  wardenTeam: "Warden team",
  anonymousTip: "Anonymous tip",
  shareTip: "Share a safety tip",
  tipPlaceholder: "For example: street lights are out on the service lane, walk in groups",
  tipRules:
    "Do not name or describe anyone. Warden checks every tip before it appears, and shows only the area, never your location.",
  sendTip: "Send tip",
  tipSent: "Thank you. Warden will check your tip before it appears.",
  flag: "Report this",
  flagged: "Thank you. Warden will look at it.",
  routeCalm: "Route looks calm",
  routeCaution: "Take care on this route",
  routeAvoid: "Think about another route or time",
  routeBasis: (n) =>
    `Based on ${n} incident(s) reported near the straight line to your destination in the last week.`,
  routeNothing: "No incidents reported near the straight line to your destination this week.",
  report: "Report",
  sos: "SOS",
  safety: "Safety",
  alerts: "Alerts",
  call112: "Call 112",
  trip: "Trip",
  menu: "Menu",
  nearYou: "Near you",
  inThisArea: "On this part of the map",
  dangerNearby: "Danger nearby",
  takeCareNearby: "Take care nearby",
  quietNearYou: "Quiet near you",
  quietTonight: "Quiet tonight",
  reportsWithin: (n, km, w) =>
    n === 0
      ? `No reports within ${km} km in the ${w}`
      : `${n} ${n === 1 ? "report" : "reports"} within ${km} km in the ${w}`,
  reportsInView: (n, w) => `${n} ${n === 1 ? "report" : "reports"} in the ${w}`,
  tapCircle: "Tap a circle to zoom in.",
  lastWindow: {
    "6h": "last 6 hours",
    "24h": "last 24 hours",
    "7d": "last 7 days",
    "30d": "last 30 days",
  },
  emergencyKey: "Emergency",
  warningKey: "Warning",
  advisoryKey: "Advisory",
  respondersKey: "Responders",
  stepOf: (n, total) => `Step ${n} of ${total}`,
  whatsHappening: "What's happening?",
  call112First: "Someone in danger right now? Call 112 first",
  privateGroupNote:
    "Private reports (sexual or domestic violence, missing person) never appear on the map.",
  privateShort: "Private. Never on the map.",
  anonymousNoName: "Anonymous. Warden never asks for your name.",
  whichOne: (group) => `${group}: which one?`,
  whereDidItHappen: "Where did it happen?",
  whereIAmNow: "Where I am now",
  chooseOnMap: "Choose on the map",
  locationStaysHere: "Your own location stays on this phone. Only the place you report is sent.",
  noLocation: "We could not get your location. Choose the place on the map instead.",
  privateOnlyStaff: "This report goes only to trained staff. It will never appear on the map.",
  anythingElse: "Anything else? (optional)",
  describePlaceholder: "What did you see? For example: two men on a red motorcycle.",
  noNames: "Please do not include names, phone numbers, or anyone's ethnicity or religion.",
  sendReport: "Send report",
  backToMap: "Back to the map",
  howLong: "How long will it take?",
  lateHelp: "If you have not arrived 10 minutes after this, Warden texts your trusted contacts.",
  whereTo: "Where to? (optional)",
  pickOnMap: "Pick on map",
  placeOnMap: "Place on the map",
  whereGoing: "Where are you going?",
  moveToDestination: "Move the map so the pin is where you are going.",
  noteForContacts: "Note for your contacts (optional)",
  notePlaceholder: "For example: Bolt, blue Corolla, plate KJA 123 XY",
  noContactsTrip:
    "You have no trusted contacts yet. You can still share the link yourself, but Warden cannot text anyone if you are late.",
  addContacts: "Add trusted contacts",
  startSharing: "Start sharing",
  starting: "Starting...",
  tripPrivacy:
    "While sharing, Android shows a Warden notification. Your location goes only to people with your private link and is deleted two days after the trip ends.",
  shareMyTrip: "Share my trip",
  sharingLive: "Sharing your live location",
  whoIsTold: "Who is being told",
  getsText: "Gets a text with your live location",
  respondersNear: "Responders near you",
  respondersCanSee: "Verified teams in your area can see this SOS",
  needsPin: "Needs your PIN",
  willGetLocation: (names) => `${names} will get your live location.`,
  and: "and",
  seconds: "seconds",
  pressedByMistake: "Pressed by mistake? Cancel now. No PIN needed yet.",
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
  community: "Community",
  communityHelp: "Tori from people wey dey near, Warden check am before e show, plus notice.",
  noPosts: "Nobody never post anything for this area.",
  wardenTeam: "Warden team",
  anonymousTip: "Tip wey nobody know who send am",
  shareTip: "Share safety tip",
  tipPlaceholder: "Like: light no dey for the service lane, waka together",
  tipRules:
    "No call anybody name or describe person. Warden go check every tip before e show, and na only the area we go show, no be where you dey.",
  sendTip: "Send the tip",
  tipSent: "Thank you. Warden go check your tip before e show.",
  flag: "Report am",
  flagged: "Thank you. Warden go look am.",
  routeCalm: "The road be like say e calm",
  routeCaution: "Shine your eye for this road",
  routeAvoid: "Think about another road or another time",
  routeBasis: (n) =>
    `Na ${n} wahala wey people report near the straight line to where you dey go for this one week.`,
  routeNothing: "Nobody report wahala near the straight line to where you dey go this week.",
  report: "Report",
  sos: "SOS",
  safety: "Safety",
  alerts: "Alert",
  call112: "Call 112",
  trip: "Trip",
  menu: "Menu",
  nearYou: "For your area",
  inThisArea: "For this side of the map",
  dangerNearby: "Wahala dey nearby",
  takeCareNearby: "Shine your eye for nearby",
  quietNearYou: "E quiet for your area",
  quietTonight: "E quiet tonight",
  reportsWithin: (n, km, w) =>
    n === 0
      ? `Nobody report anything inside ${km} km for the ${w}`
      : `${n} report inside ${km} km for the ${w}`,
  reportsInView: (n, w) => `${n} report for the ${w}`,
  tapCircle: "Touch any circle to zoom in.",
  lastWindow: {
    "6h": "last 6 hours",
    "24h": "last 24 hours",
    "7d": "last 7 days",
    "30d": "last 30 days",
  },
  emergencyKey: "Emergency",
  warningKey: "Warning",
  advisoryKey: "Advisory",
  respondersKey: "Responders",
  stepOf: (n, total) => `Step ${n} of ${total}`,
  whatsHappening: "Wetin dey happen?",
  call112First: "Person dey for danger now? Call 112 first",
  privateGroupNote:
    "Private report (sexual or domestic violence, person wey miss) no go ever show for map.",
  privateShort: "Private. E no go show for map.",
  anonymousNoName: "Nobody go know na you. Warden no dey ask your name.",
  whichOne: (group) => `${group}: which one?`,
  whereDidItHappen: "Where e happen?",
  whereIAmNow: "Where I dey now",
  chooseOnMap: "Choose am for map",
  locationStaysHere:
    "Your own location go stay for this phone. Na only the place wey you report we go send.",
  noLocation: "We no fit get your location. Choose the place for map instead.",
  privateOnlyStaff: "Na only trained staff go see this report. E no go ever show for map.",
  anythingElse: "Anything again? (if you like)",
  describePlaceholder: "Wetin you see? Like: two men for red okada.",
  noNames: "Abeg no put person name, phone number, tribe or religion.",
  sendReport: "Send the report",
  backToMap: "Go back to map",
  howLong: "How long e go take?",
  lateHelp:
    "If you never reach 10 minutes after this time, Warden go text the people wey you trust.",
  whereTo: "Where you dey go? (if you like)",
  pickOnMap: "Pick am for map",
  placeOnMap: "Place for map",
  whereGoing: "Where you dey go?",
  moveToDestination: "Move the map make the pin dey where you dey go.",
  noteForContacts: "Message for your people (if you like)",
  notePlaceholder: "Like: Bolt, blue Corolla, plate KJA 123 XY",
  noContactsTrip:
    "You never add people wey you trust. You fit still send the link yourself, but Warden no fit text anybody if you late.",
  addContacts: "Add people wey you trust",
  startSharing: "Start to share",
  starting: "E dey start...",
  tripPrivacy:
    "When you dey share, Android go show Warden notification. Na only people wey get your private link go see your location, and we go delete am two days after the journey finish.",
  shareMyTrip: "Share my journey",
  sharingLive: "We dey share where you dey",
  whoIsTold: "Who we dey tell",
  getsText: "Go get text wey show where you dey",
  respondersNear: "Responders wey dey near you",
  respondersCanSee: "Verified teams for your area fit see this SOS",
  needsPin: "E need your PIN",
  willGetLocation: (names) => `${names} go see where you dey, live.`,
  and: "and",
  seconds: "seconds",
  pressedByMistake: "You press am by mistake? Cancel now. You no need PIN yet.",
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
