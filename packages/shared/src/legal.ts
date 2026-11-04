// The privacy notice and terms of use (M11), shown in the app and at /privacy and /terms.
//
// DRAFT for legal review. Written from what the code actually does, in plain language, for a
// Nigerian lawyer to correct against the Nigeria Data Protection Act 2023 and the NDPC's rules.
// Text in [square brackets] is for the founder or the lawyer to fill in. Bump the version
// whenever the meaning changes; the app asks people to read and accept the new one.

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocument {
  id: "privacy" | "terms";
  title: string;
  version: string;
  /** True until a lawyer has approved the text. Shown as a banner wherever the text appears. */
  draft: boolean;
  sections: LegalSection[];
}

export const PRIVACY_NOTICE: LegalDocument = {
  id: "privacy",
  title: "Privacy notice",
  version: "2026-11-draft-1",
  draft: true,
  sections: [
    {
      heading: "Who we are",
      paragraphs: [
        "Warden is run by [company name], registered in Nigeria as [CAC number], at [address]. We are responsible for the personal data described here. You can reach us, including our data protection officer, at [email address].",
        "Warden is a safety service: a map of reported incidents, anonymous reporting, alerts, trip sharing and SOS. It does not replace 112.",
      ],
    },
    {
      heading: "The short version",
      paragraphs: [
        "You do not need an account, a name or a phone number to use Warden.",
        "Reports never carry your name. The public map shows areas a few hundred metres across, never exact spots.",
        "Your trusted contacts, saved places and PIN stay on your phone. Your live location is shared only while you choose to share a trip or press SOS, only with the people you picked, and it is deleted two days after the trip or SOS ends.",
        "We do not sell personal data, and we do not show ads.",
      ],
    },
    {
      heading: "What we collect, and why",
      paragraphs: [
        "Using the map: the part of the map on your screen, so we can send the incidents there. Not your own position.",
        "Reporting: what happened, where and when, any words you add, how far you were (for example 'within 200 m'), and any voice note, photo or video you attach. Photos and videos have their hidden location and phone details removed. We use reports to check incidents and show them on the map as areas. Legal basis: [legitimate interests in public safety / consent; lawyer to confirm].",
        "A random number made by the app on your phone (an install ID). It lets us limit abuse and tell one person's reports from another's. It is not linked to you, and we keep only a scrambled form of it.",
        "Alerts: the app asks for incidents in wide squares around your saved places and works out on your phone which ones are near you. We never receive your places.",
        "Community tips, and flags on incidents and tips: the words of the tip and the area of the map it is about. A moderator reads every tip before anyone sees it.",
        "Trips and SOS: your first name as your contacts know you, your contacts' phone numbers, your live location, where you are going and any note, and, if you turn it on, sound recorded during an SOS. We use them to text your contacts and to show them your location on a private link. Legal basis: [consent / vital interests; lawyer to confirm].",
        "Trusted reporter codes: if Warden gave you one, reports sent with it are marked as coming from a trusted reporter, never which one.",
        "USSD reports: your phone number is used only as a scrambled key to limit abuse; your report is placed at the middle of your local government area.",
      ],
    },
    {
      heading: "What stays on your phone",
      paragraphs: [
        "Your trusted contacts list, saved places, safety PIN and duress PIN, settings, and the list of reports you sent. They are not backed up to the cloud by Warden. If you delete the app, they are gone.",
      ],
    },
    {
      heading: "Who can see what",
      paragraphs: [
        "Everyone: incidents as areas, with their type, time, how sure we are, and public updates from responders. Never names, report words, files or exact places.",
        "Warden's trained moderators: exact report locations, report words and files, to check incidents. Every time they open one, it is written to a log that cannot be quietly changed.",
        "Verified responders (for example a police division or ambulance service) we have checked: incidents of public types in their own area, and an SOS only if the person turned on 'also alert responders near me'. Their views are logged too.",
        "Your trusted contacts: your live location and status during a trip or SOS you started, through a private link.",
        "Reports of sexual or domestic violence and missing persons are private: they never appear on the map and never go to responders, fleets or data customers.",
        "Transport companies and businesses that pay for Warden data see only what is already on the public map, as areas, with small counts left out so no single report can be picked out.",
      ],
    },
    {
      heading: "Who else handles data for us",
      paragraphs: [
        "[SMS provider, for example Termii], to send texts to your contacts. They receive the phone number and the text.",
        "[Hosting provider and country], where our server runs. [Backup storage provider and country], for encrypted backups.",
        "Map pictures come from OpenFreeMap and OpenStreetMap; they receive the map squares your phone shows, like any map app.",
        "We will share data with the police or a court only when the law requires it, and only what the request covers. [Lawyer to describe the process.]",
        "[If data leaves Nigeria, the transfer basis under the NDPA; lawyer to complete.]",
      ],
    },
    {
      heading: "How long we keep it",
      paragraphs: [
        "Trip and SOS details, including live locations and contacts' numbers: deleted two days after the trip or SOS ends.",
        "Voice notes, photos, videos and SOS sound: deleted after 30 days.",
        "Reports: [period to be decided; until then they are kept, encrypted]. Incidents on the map stay as areas for statistics.",
        "Moderator and responder logs: [period to be decided], so their actions can be checked.",
        "Encrypted backups: 14 days.",
      ],
    },
    {
      heading: "How we protect it",
      paragraphs: [
        "Exact locations, report words, files, contacts' numbers and live locations are encrypted on our server. Everything travels over encrypted connections. Staff accounts need a password and every sensitive view is logged. Our web server does not keep a log of visitors' internet addresses.",
      ],
    },
    {
      heading: "Your rights",
      paragraphs: [
        "Under the Nigeria Data Protection Act 2023 you can ask to see, correct or delete personal data about you, object to how we use it, and withdraw consent. Write to [email address]. Because reports are anonymous, we may not be able to tell which are yours; your phone's 'My reports' list helps.",
        "You can complain to the Nigeria Data Protection Commission (NDPC) at [contact details].",
      ],
    },
    {
      heading: "Children",
      paragraphs: ["Warden is meant for people aged [18] and over."],
    },
    {
      heading: "Changes",
      paragraphs: [
        "If we change this notice in a way that matters, the app will show you the new version before you carry on. Version 2026-11-draft-1.",
      ],
    },
  ],
};

export const TERMS_OF_USE: LegalDocument = {
  id: "terms",
  title: "Terms of use",
  version: "2026-11-draft-1",
  draft: true,
  sections: [
    {
      heading: "What Warden is and is not",
      paragraphs: [
        "Warden helps people share and see safety information and reach the people they trust. It is not an emergency service and does not replace 112, the police or medical help. In danger, call 112 first if you can.",
        "Alerts can arrive late or not at all (for example with no signal or when the phone saves battery), and texts depend on the mobile networks. Do not rely on Warden alone.",
        "Reports come from members of the public. We check them as well as we can and show how sure we are, but we cannot promise every report is true or complete.",
      ],
    },
    {
      heading: "Using Warden fairly",
      paragraphs: [
        "Only report what you saw, heard or know to be happening. False reports can put people in danger and may be passed to the authorities where the law requires.",
        "Do not name, describe or point to any person in reports or tips, and do not include anyone's ethnicity or religion.",
        "Do not use trip sharing or SOS to send messages to people who did not agree to be your contacts, or to harass anyone.",
        "Do not try to find out who sent a report, to get around Warden's limits, or to copy Warden's data in bulk.",
      ],
    },
    {
      heading: "What we can do",
      paragraphs: [
        "We can hold, change the label of, or remove any report, tip or update, and block abuse. We may change or stop parts of the service; we will try to give notice of big changes in the app.",
      ],
    },
    {
      heading: "Liability",
      paragraphs: [
        "[Lawyer to write the limits of liability that Nigerian law allows, in plain language.]",
      ],
    },
    {
      heading: "The law",
      paragraphs: [
        "These terms are governed by the laws of the Federal Republic of Nigeria. [Lawyer to confirm courts and any dispute process.] Questions: [email address].",
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS = { privacy: PRIVACY_NOTICE, terms: TERMS_OF_USE } as const;

/** The version a person accepts in the app; changes when either document changes. */
export const LEGAL_VERSION = `${PRIVACY_NOTICE.version}+${TERMS_OF_USE.version}`;
