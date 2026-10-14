// Support services shown after a private report (M6): sexual and domestic violence, missing
// persons. These reports never go on the map; instead the person is pointed to help.
//
// Only services with verified: true are ever shown. The entries below are PLACEHOLDERS: the
// founder must confirm each organisation and its phone number with the organisation itself
// before setting verified to true (docs/milestones.md). Until then the app shows 112 and says
// that local services are being confirmed.

import type { CategoryId } from "./categories.ts";

export const SUPPORT_KINDS = ["counselling", "medical", "legal", "shelter", "missing"] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];

export interface SupportService {
  id: string;
  name: string;
  kind: SupportKind;
  /** What the service helps with. */
  categories: CategoryId[];
  /** Two-letter state codes it covers, or "all" for national services. */
  states: string[] | "all";
  phone: string;
  /** Confirmed with the organisation by Warden. Unverified entries are never shown. */
  verified: boolean;
}

const PERSONAL: CategoryId[] = ["sexual_violence", "domestic_violence"];

export const SUPPORT_SERVICES: SupportService[] = [
  {
    id: "placeholder-sarc-lagos",
    name: "Sexual assault referral centre (Lagos) - to be confirmed",
    kind: "medical",
    categories: ["sexual_violence"],
    states: ["LA"],
    phone: "",
    verified: false,
  },
  {
    id: "placeholder-sarc-fct",
    name: "Sexual assault referral centre (Abuja) - to be confirmed",
    kind: "medical",
    categories: ["sexual_violence"],
    states: ["FC"],
    phone: "",
    verified: false,
  },
  {
    id: "placeholder-dv-helpline",
    name: "Domestic violence helpline - to be confirmed",
    kind: "counselling",
    categories: PERSONAL,
    states: "all",
    phone: "",
    verified: false,
  },
  {
    id: "placeholder-legal-aid",
    name: "Free legal help - to be confirmed",
    kind: "legal",
    categories: PERSONAL,
    states: "all",
    phone: "",
    verified: false,
  },
  {
    id: "placeholder-missing-persons",
    name: "Missing persons desk - to be confirmed",
    kind: "missing",
    categories: ["missing_person"],
    states: "all",
    phone: "",
    verified: false,
  },
];

/** Verified services for a category, local ones first. */
export function supportFor(
  categoryId: string,
  state: string | null = null,
  services: SupportService[] = SUPPORT_SERVICES,
): SupportService[] {
  return services
    .filter(
      (s) =>
        s.verified &&
        s.phone !== "" &&
        s.categories.includes(categoryId as CategoryId) &&
        (s.states === "all" || (state !== null && s.states.includes(state))),
    )
    .sort((a, b) => Number(a.states === "all") - Number(b.states === "all"));
}
