// First-run setup (M10): welcome, privacy, location, trusted contacts, PIN, home, ready.
// Everything it collects stays on the phone, in the same stores the Safety and Places screens use.

import type { KeyValueStore } from "./outbox.ts";

const ONBOARDED_KEY = "warden.onboarded.v1";

export const ONBOARDING_STEPS = [
  "welcome",
  "privacy",
  "location",
  "contacts",
  "pin",
  "home",
  "ready",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** The numbered steps ("2 of 5") are the five between the welcome and the end. */
export const NUMBERED_STEPS: readonly OnboardingStep[] = [
  "privacy",
  "location",
  "contacts",
  "pin",
  "home",
];

export function nextStep(step: OnboardingStep): OnboardingStep {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.min(i + 1, ONBOARDING_STEPS.length - 1)] ?? "ready";
}

export function previousStep(step: OnboardingStep): OnboardingStep {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.max(i - 1, 0)] ?? "welcome";
}

export async function isOnboarded(store: KeyValueStore): Promise<boolean> {
  return (await store.getItem(ONBOARDED_KEY)) === "1";
}

export async function markOnboarded(store: KeyValueStore): Promise<void> {
  await store.setItem(ONBOARDED_KEY, "1");
}

/** The setup PIN is four digits typed on Warden's own keypad (Safety settings allow up to six). */
export const SETUP_PIN_LENGTH = 4;

/** A keypad press: a digit adds to the PIN until it is full; "back" removes the last digit. */
export function pressKey(value: string, key: string, length: number = SETUP_PIN_LENGTH): string {
  if (key === "back") return value.slice(0, -1);
  if (!/^\d$/.test(key) || value.length >= length) return value;
  return value + key;
}
