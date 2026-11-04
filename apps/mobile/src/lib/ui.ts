import type { GroupId } from "@warden/shared";
import type { Tone } from "../components/ui.tsx";

/**
 * Report groups in plainer words for the app (the console keeps the shared taxonomy's names).
 * The personal group holds the private categories, so it says so.
 */
export const GROUP_LABELS: Record<GroupId, string> = {
  violent_crime: "Violent crime",
  property_crime: "Theft and burglary",
  road: "Road and transport",
  fraud: "Fraud and fake officials",
  public_order: "Crowds and unrest",
  hazard: "Fire, flood and hazards",
  personal: "Personal safety",
};

export const GROUP_TONES: Record<GroupId, Tone> = {
  violent_crime: "danger",
  property_crime: "warning",
  road: "advisory",
  fraud: "neutral",
  public_order: "responder",
  hazard: "hazard",
  personal: "primary",
};

export const GROUP_ICONS: Record<GroupId, string> = {
  violent_crime: "alert-octagon",
  property_crime: "bag-personal",
  road: "car",
  fraud: "account-cash",
  public_order: "account-group",
  hazard: "fire",
  personal: "hand-heart",
};
