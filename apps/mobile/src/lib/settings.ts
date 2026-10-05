import type { KeyValueStore } from "./outbox.ts";

export interface Settings {
  apiUrl: string;
  demoMode: boolean;
}

const SETTINGS_KEY = "warden.settings.v1";
const INSTALL_KEY = "warden.install.v1";

/**
 * HTTPS only: Android release builds refuse plain HTTP, and reports must travel encrypted.
 * A pattern rather than `new URL()`, whose React Native implementation is incomplete.
 */
const SERVER_URL = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?(\/[^\s]*)?$/i;

export function isValidServerUrl(value: string): boolean {
  return value === "" || SERVER_URL.test(value);
}

export async function loadSettings(store: KeyValueStore, builtInApiUrl: string): Promise<Settings> {
  const fallback: Settings = { apiUrl: builtInApiUrl, demoMode: builtInApiUrl === "" };
  const raw = await store.getItem(SETTINGS_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      apiUrl: typeof parsed.apiUrl === "string" ? parsed.apiUrl : fallback.apiUrl,
      demoMode: typeof parsed.demoMode === "boolean" ? parsed.demoMode : fallback.demoMode,
    };
  } catch {
    return fallback;
  }
}

export async function saveSettings(store: KeyValueStore, settings: Settings): Promise<void> {
  await store.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * A random id for this installation. It lets the server spot repeat reports from one phone and
 * rate-limit abuse; it is not linked to a person and is never stored by the server as-is.
 */
export async function getInstallId(store: KeyValueStore, newId: () => string): Promise<string> {
  const existing = await store.getItem(INSTALL_KEY);
  if (existing) return existing;
  const id = newId();
  await store.setItem(INSTALL_KEY, id);
  return id;
}
