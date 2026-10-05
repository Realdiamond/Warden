// The incident taxonomy from PRD module 2. Severity drives publication rules and public
// precision; handling decides whether a category can ever appear on the public map.

export type Severity = "critical" | "high" | "standard";

/** "private" categories never appear on the public map; they go to support referral. */
export type Handling = "public" | "private";

export type GroupId =
  | "violent_crime"
  | "property_crime"
  | "road"
  | "fraud"
  | "public_order"
  | "hazard"
  | "personal";

export interface CategoryGroup {
  id: GroupId;
  label: string;
}

export interface Category {
  id: string;
  group: GroupId;
  label: string;
  /** Wording shown on the public map when it differs from the reporting label. */
  publicLabel?: string;
  severity: Severity;
  handling: Handling;
  /** Responders see it first; public publication is delayed and blurred more. */
  respondersFirst?: boolean;
  /** Triggers a check with the agency that should own the area. */
  agencyCheck?: boolean;
  /** MaterialCommunityIcons glyph name used by the app. */
  icon: string;
}

export const CATEGORY_GROUPS: readonly CategoryGroup[] = [
  { id: "violent_crime", label: "Violent crime" },
  { id: "property_crime", label: "Property crime" },
  { id: "road", label: "Road and transport" },
  { id: "fraud", label: "Fraud and impersonation" },
  { id: "public_order", label: "Public order" },
  { id: "hazard", label: "Hazards" },
  { id: "personal", label: "Personal safety" },
];

export const CATEGORIES = [
  // Violent crime
  {
    id: "armed_robbery",
    group: "violent_crime",
    label: "Armed robbery",
    severity: "high",
    handling: "public",
    icon: "pistol",
  },
  {
    id: "kidnapping",
    group: "violent_crime",
    label: "Kidnapping",
    severity: "critical",
    handling: "public",
    respondersFirst: true,
    icon: "account-alert",
  },
  {
    id: "assault",
    group: "violent_crime",
    label: "Assault",
    severity: "high",
    handling: "public",
    icon: "alert-octagon",
  },
  {
    id: "shooting",
    group: "violent_crime",
    label: "Shooting",
    severity: "critical",
    handling: "public",
    icon: "target",
  },
  {
    id: "killing",
    group: "violent_crime",
    label: "Killing",
    severity: "critical",
    handling: "public",
    icon: "alert-octagram",
  },
  {
    id: "cult_clash",
    group: "violent_crime",
    label: "Cult clash",
    severity: "high",
    handling: "public",
    icon: "account-group",
  },
  {
    id: "bandit_attack",
    group: "violent_crime",
    label: "Bandit attack",
    severity: "critical",
    handling: "public",
    icon: "shield-alert",
  },
  // Property crime
  {
    id: "theft",
    group: "property_crime",
    label: "Theft",
    severity: "standard",
    handling: "public",
    icon: "bag-personal",
  },
  {
    id: "burglary",
    group: "property_crime",
    label: "Burglary",
    severity: "standard",
    handling: "public",
    icon: "home-alert",
  },
  {
    id: "phone_snatching",
    group: "property_crime",
    label: "Phone snatching",
    severity: "standard",
    handling: "public",
    icon: "cellphone",
  },
  {
    id: "vehicle_theft",
    group: "property_crime",
    label: "Vehicle or motorcycle theft",
    severity: "standard",
    handling: "public",
    icon: "car-key",
  },
  {
    id: "one_chance",
    group: "property_crime",
    label: '"One chance" robbery in a vehicle',
    severity: "high",
    handling: "public",
    icon: "bus-alert",
  },
  // Road and transport
  {
    id: "crash",
    group: "road",
    label: "Road crash",
    severity: "standard",
    handling: "public",
    icon: "car-emergency",
  },
  {
    id: "hit_and_run",
    group: "road",
    label: "Hit-and-run",
    severity: "standard",
    handling: "public",
    icon: "car-side",
  },
  {
    id: "road_blockage",
    group: "road",
    label: "Road blocked",
    severity: "standard",
    handling: "public",
    icon: "road-variant",
  },
  {
    id: "fake_checkpoint",
    group: "road",
    label: "Suspected fake checkpoint",
    severity: "high",
    handling: "public",
    agencyCheck: true,
    icon: "police-badge",
  },
  {
    id: "dangerous_driving",
    group: "road",
    label: "Dangerous driving",
    severity: "standard",
    handling: "public",
    icon: "speedometer",
  },
  // Fraud and impersonation
  {
    id: "fake_officials",
    group: "fraud",
    label: "Fake police or officials",
    severity: "standard",
    handling: "public",
    icon: "card-account-details-outline",
  },
  {
    id: "pos_fraud",
    group: "fraud",
    label: "POS or card fraud",
    severity: "standard",
    handling: "public",
    icon: "credit-card-off",
  },
  {
    id: "scam_calls",
    group: "fraud",
    label: "Scam calls or messages",
    severity: "standard",
    handling: "public",
    icon: "phone-alert",
  },
  // Public order
  {
    id: "protest",
    group: "public_order",
    label: "Protest or gathering",
    publicLabel: "Gathering",
    severity: "standard",
    handling: "public",
    icon: "account-multiple",
  },
  {
    id: "riot",
    group: "public_order",
    label: "Riot",
    severity: "high",
    handling: "public",
    icon: "fire-alert",
  },
  {
    id: "communal_clash",
    group: "public_order",
    label: "Communal clash",
    severity: "critical",
    handling: "public",
    icon: "account-group-outline",
  },
  {
    id: "gunfire_heard",
    group: "public_order",
    label: "Gunfire heard",
    severity: "high",
    handling: "public",
    icon: "volume-high",
  },
  {
    id: "explosion",
    group: "public_order",
    label: "Explosion",
    severity: "critical",
    handling: "public",
    icon: "bomb",
  },
  // Hazards
  {
    id: "fire",
    group: "hazard",
    label: "Fire",
    severity: "high",
    handling: "public",
    icon: "fire",
  },
  {
    id: "flood",
    group: "hazard",
    label: "Flood",
    severity: "high",
    handling: "public",
    icon: "home-flood",
  },
  {
    id: "building_collapse",
    group: "hazard",
    label: "Building collapse",
    severity: "critical",
    handling: "public",
    icon: "office-building",
  },
  {
    id: "tanker_incident",
    group: "hazard",
    label: "Tanker incident",
    severity: "critical",
    handling: "public",
    icon: "tanker-truck",
  },
  {
    id: "gas_leak",
    group: "hazard",
    label: "Gas leak",
    severity: "high",
    handling: "public",
    icon: "gas-cylinder",
  },
  {
    id: "live_wire",
    group: "hazard",
    label: "Fallen live wire",
    severity: "high",
    handling: "public",
    icon: "flash-alert",
  },
  // Personal safety
  {
    id: "sexual_violence",
    group: "personal",
    label: "Sexual violence",
    severity: "critical",
    handling: "private",
    icon: "hand-heart",
  },
  {
    id: "domestic_violence",
    group: "personal",
    label: "Domestic violence",
    severity: "high",
    handling: "private",
    icon: "home-heart",
  },
  {
    id: "missing_person",
    group: "personal",
    label: "Missing person",
    severity: "high",
    handling: "private",
    icon: "account-search",
  },
  {
    id: "suspicious_behaviour",
    group: "personal",
    label: "Suspicious behaviour",
    severity: "standard",
    handling: "public",
    icon: "eye",
  },
] as const satisfies readonly Category[];

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]];

const byId = new Map<string, Category>(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): Category | undefined {
  return byId.get(id);
}

export function requireCategory(id: string): Category {
  const category = byId.get(id);
  if (!category) throw new Error(`Unknown category: ${id}`);
  return category;
}

/** The label the public sees, which can be softer than the reporting label. */
export function publicLabelOf(category: Category): string {
  return category.publicLabel ?? category.label;
}

export function categoriesInGroup(group: GroupId): Category[] {
  return CATEGORIES.filter((c) => c.group === group);
}
