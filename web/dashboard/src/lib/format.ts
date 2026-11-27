const APP_NAMES: Record<string, string> = {
  "com.whatsapp": "WhatsApp",
  "com.whatsapp.w4b": "WhatsApp Business",
  "org.telegram.messenger": "Telegram",
  "com.facebook.orca": "Messenger",
  "com.instagram.android": "Instagram",
  "com.snapchat.android": "Snapchat",
  "com.zhiliaoapp.musically": "TikTok",
  "com.ss.android.ugc.trill": "TikTok",
  "org.thoughtcrime.securesms": "Signal",
};

export function appName(pkg: string): string {
  if (APP_NAMES[pkg]) return APP_NAMES[pkg];
  const parts = pkg.split(".");
  return parts[parts.length - 1] || pkg;
}

export interface Presence {
  live: boolean;
  label: string;
}

/** Plain-language "is the phone around?" status from the last time it reported in. */
export function presence(lastSeenAt: string | null | undefined, now = Date.now()): Presence {
  if (!lastSeenAt) return { live: false, label: "Not seen yet" };
  const mins = Math.max(0, Math.round((now - new Date(lastSeenAt).getTime()) / 60_000));
  if (mins < 5) return { live: true, label: "Active now" };
  if (mins < 60) return { live: false, label: `Last active ${mins} min ago` };
  const hours = Math.round(mins / 60);
  if (hours < 24) return { live: false, label: `Last active ${hours} h ago` };
  return { live: false, label: `Last active ${new Date(lastSeenAt).toLocaleDateString()}` };
}

export function initial(name: string): string {
  const c = name.trim()[0];
  return c ? c.toUpperCase() : "?";
}

export function shortTime(at: string): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function dayLabel(at: string | Date): string {
  const d = typeof at === "string" ? new Date(at) : at;
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** A stable hue per name, for avatar chips. */
export function avatarHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "<1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatCallDuration(sec: number): string {
  if (sec <= 0) return "No answer";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

/** Distance in metres between two coordinates. */
export function metersBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
