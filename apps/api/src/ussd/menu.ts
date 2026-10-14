// USSD menu for phones without data (PRD module 11). The provider sends everything the caller
// has typed so far ("1*2*5"), so the menu is worked out from that text alone, with no session
// state on the server. Replies start with CON (more to come) or END (finished).

import { USSD_CATEGORIES, USSD_REGIONS } from "./areas.ts";

const PAGE_SIZE = 8;
const MORE = "9";

export type UssdStep =
  | { kind: "reply"; text: string }
  | { kind: "submit"; categoryId: string; area: { name: string; lat: number; lng: number } };

const con = (text: string): UssdStep => ({ kind: "reply", text: `CON ${text}` });
const end = (text: string): UssdStep => ({ kind: "reply", text: `END ${text}` });

const INVALID = end("That choice is not on the list. Please dial again.");

export const EMERGENCY_TEXT =
  "Emergency: call 112 (police, fire, ambulance). Lagos also 767. Warden does not replace 112.";

function list(items: string[], from = 1): string {
  return items.map((item, i) => `${i + from}. ${item}`).join("\n");
}

export function ussdStep(input: string): UssdStep {
  const tokens = input.trim() === "" ? [] : input.trim().split("*");
  let i = 0;
  const next = () => tokens[i++];

  // Main menu
  if (tokens.length === 0)
    return con(`Warden safety\n${list(["Report an incident", "Emergency numbers"])}`);
  const main = next();
  if (main === "2") return end(EMERGENCY_TEXT);
  if (main !== "1") return INVALID;

  // Region
  if (i === tokens.length) return con(`Where?\n${list(USSD_REGIONS.map((r) => r.name))}`);
  const region = USSD_REGIONS[Number(next()) - 1];
  if (!region) return INVALID;

  // Area, eight to a page, "9" for more
  let page = 0;
  let area: (typeof region.areas)[number] | undefined;
  while (!area) {
    const start = page * PAGE_SIZE;
    const shown = region.areas.slice(start, start + PAGE_SIZE);
    const hasMore = start + PAGE_SIZE < region.areas.length;
    if (i === tokens.length) {
      const more = hasMore ? `\n${MORE}. More` : "";
      return con(`Which area of ${region.name}?\n${list(shown.map((a) => a.name))}${more}`);
    }
    const choice = next();
    if (choice === MORE && hasMore) {
      page += 1;
      continue;
    }
    area = shown[Number(choice) - 1];
    if (!area) return INVALID;
  }

  // Category
  if (i === tokens.length)
    return con(`What is happening?\n${list(USSD_CATEGORIES.map((c) => c.name))}`);
  const category = USSD_CATEGORIES[Number(next()) - 1];
  if (!category) return INVALID;

  // Confirm
  if (i === tokens.length) {
    return con(
      `Report ${category.name} in ${area.name}?\nYour number is not shown to anyone.\n1. Send\n2. Cancel`,
    );
  }
  const confirm = next();
  if (i !== tokens.length) return INVALID;
  if (confirm === "2") return end("Cancelled. Nothing was sent.");
  if (confirm !== "1") return INVALID;
  return { kind: "submit", categoryId: category.id, area };
}
