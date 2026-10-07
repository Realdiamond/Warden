// Trusted contacts and the name they know you by. Kept on this phone; sent to the server only
// when a trip or SOS starts, so Warden can text them if needed.

import { MAX_CONTACTS, MAX_PERSON_NAME, normalizeNigerianPhone } from "@warden/shared";
import type { KeyValueStore } from "./outbox.ts";

export interface TrustedContact {
  id: string;
  name: string;
  /** +234... */
  phone: string;
  invited: boolean;
}

export interface SafetyProfile {
  personName: string;
  contacts: TrustedContact[];
  /** Also show an SOS to verified responders in the area (off unless the person turns it on). */
  shareSosWithResponders: boolean;
}

const PROFILE_KEY = "warden.safetyProfile.v1";

export const EMPTY_PROFILE: SafetyProfile = {
  personName: "",
  contacts: [],
  shareSosWithResponders: false,
};

export async function loadProfile(store: KeyValueStore): Promise<SafetyProfile> {
  const raw = await store.getItem(PROFILE_KEY);
  if (!raw) return EMPTY_PROFILE;
  try {
    const p = JSON.parse(raw) as Partial<SafetyProfile>;
    const contacts = Array.isArray(p.contacts)
      ? p.contacts.filter(
          (c): c is TrustedContact =>
            typeof c?.id === "string" &&
            typeof c.name === "string" &&
            typeof c.phone === "string" &&
            normalizeNigerianPhone(c.phone) !== null,
        )
      : [];
    return {
      personName: typeof p.personName === "string" ? p.personName : "",
      contacts: contacts.slice(0, MAX_CONTACTS),
      shareSosWithResponders: p.shareSosWithResponders === true,
    };
  } catch {
    return EMPTY_PROFILE;
  }
}

export async function saveProfile(store: KeyValueStore, profile: SafetyProfile): Promise<void> {
  await store.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export type ContactCheck = { ok: true; contact: TrustedContact } | { ok: false; message: string };

export function makeContact(
  existing: TrustedContact[],
  input: { id: string; name: string; phone: string },
): ContactCheck {
  const name = input.name.trim().slice(0, MAX_PERSON_NAME);
  if (!name) return { ok: false, message: "Enter a name." };
  const phone = normalizeNigerianPhone(input.phone);
  if (!phone) return { ok: false, message: "Enter a Nigerian mobile number, like 0803 123 4567." };
  if (existing.length >= MAX_CONTACTS) {
    return { ok: false, message: `You can add up to ${MAX_CONTACTS} contacts.` };
  }
  if (existing.some((c) => c.phone === phone)) {
    return { ok: false, message: "That number is already a trusted contact." };
  }
  return { ok: true, contact: { id: input.id, name, phone, invited: false } };
}

/** Sent from the person's own phone, so the contact knows who added them and why. */
export function inviteText(personName: string): string {
  const who = personName.trim() || "I";
  return `Hi, it's ${who}. I've added you as a trusted contact on Warden, a safety app. If I press SOS or don't arrive somewhere on time, you may get a text with a link to my live location. Please reply to say that's OK.`;
}

/** 0803 123 4567 style, for display. */
export function displayPhone(phone: string): string {
  const national = phone.replace(/^\+234/, "0");
  return national.replace(/^(\d{4})(\d{3})(\d{4})$/, "$1 $2 $3");
}
