// Safety PIN and duress PIN. The PIN stops a trip or SOS. The duress PIN, entered when someone
// forces you to stop, looks exactly the same on screen but tells your contacts you are in danger.
// Only salted hashes are stored.

import type { KeyValueStore } from "./outbox.ts";

export interface PinSettings {
  salt: string;
  pinHash: string | null;
  duressHash: string | null;
}

export type HashFn = (text: string) => Promise<string>;
export type PinCheck = "ok" | "duress" | "wrong" | "none";

export const PIN_PATTERN = /^\d{4,6}$/;
const PIN_KEY = "warden.pins.v1";

export async function loadPins(store: KeyValueStore): Promise<PinSettings | null> {
  const raw = await store.getItem(PIN_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as PinSettings;
    return typeof p.salt === "string" ? p : null;
  } catch {
    return null;
  }
}

export async function savePins(store: KeyValueStore, pins: PinSettings | null): Promise<void> {
  if (pins) await store.setItem(PIN_KEY, JSON.stringify(pins));
  else await store.removeItem(PIN_KEY);
}

export type PinSetup = { ok: true; pins: PinSettings } | { ok: false; message: string };

export async function setUpPins(
  input: { pin: string; duressPin: string },
  salt: string,
  hash: HashFn,
): Promise<PinSetup> {
  if (!PIN_PATTERN.test(input.pin)) return { ok: false, message: "The PIN must be 4 to 6 digits." };
  if (input.duressPin !== "" && !PIN_PATTERN.test(input.duressPin)) {
    return { ok: false, message: "The duress PIN must be 4 to 6 digits." };
  }
  if (input.duressPin === input.pin) {
    return { ok: false, message: "The duress PIN must be different from your PIN." };
  }
  return {
    ok: true,
    pins: {
      salt,
      pinHash: await hash(`${salt}:${input.pin}`),
      duressHash: input.duressPin ? await hash(`${salt}:${input.duressPin}`) : null,
    },
  };
}

export async function checkPin(
  pins: PinSettings | null,
  input: string,
  hash: HashFn,
): Promise<PinCheck> {
  if (!pins?.pinHash) return "none";
  const value = await hash(`${pins.salt}:${input}`);
  if (value === pins.pinHash) return "ok";
  if (pins.duressHash && value === pins.duressHash) return "duress";
  return "wrong";
}
