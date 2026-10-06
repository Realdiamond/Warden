// Remembers on this phone which incidents it has reacted to, so the buttons show the answer.

import type { ReactionKind } from "@warden/shared";
import type { KeyValueStore } from "./outbox.ts";

const REACTIONS_KEY = "warden.reactions.v1";
const MAX_REMEMBERED = 200;

export type ReactionMemory = Record<string, ReactionKind>;

export const REACTION_TEXT: Record<ReactionKind, string> = {
  confirm: "Still happening",
  over: "It's over",
  false: "Looks false",
};

export async function loadReactions(store: KeyValueStore): Promise<ReactionMemory> {
  const raw = await store.getItem(REACTIONS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as ReactionMemory) : {};
  } catch {
    return {};
  }
}

export async function rememberReaction(
  store: KeyValueStore,
  memory: ReactionMemory,
  incidentId: string,
  kind: ReactionKind,
): Promise<ReactionMemory> {
  const entries = [
    ...Object.entries(memory).filter(([id]) => id !== incidentId),
    [incidentId, kind] as const,
  ];
  const next = Object.fromEntries(entries.slice(-MAX_REMEMBERED)) as ReactionMemory;
  await store.setItem(REACTIONS_KEY, JSON.stringify(next));
  return next;
}
