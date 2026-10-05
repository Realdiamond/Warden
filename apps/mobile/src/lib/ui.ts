import type { GroupId } from "@warden/shared";

export const COLORS = {
  primary: "#0F5C4D",
  primaryText: "#FFFFFF",
  danger: "#B42318",
  text: "#16181D",
  muted: "#5B616E",
  border: "#D9DDE4",
  surface: "#FFFFFF",
  background: "#F6F7F9",
  warningBg: "#FFF8E6",
  warningBorder: "#E9C46A",
} as const;

export const GROUP_ICONS: Record<GroupId, string> = {
  violent_crime: "alert-octagon",
  property_crime: "bag-personal",
  road: "car",
  fraud: "account-cash",
  public_order: "account-group",
  hazard: "fire",
  personal: "hand-heart",
};
