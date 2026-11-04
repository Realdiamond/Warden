import * as Location from "expo-location";

export interface Position {
  lat: number;
  lng: number;
  accuracyM?: number;
}

/** Foreground location only. Returns null if permission is refused or no fix arrives in time. */
export async function currentPosition(timeoutMs = 15_000): Promise<Position | null> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") return null;
  const fix = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const position = await Promise.race([fix, timeout]).catch(() => null);
  if (!position) return null;
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracyM: position.coords.accuracy ?? undefined,
  };
}

/**
 * The phone's position without asking: only if location is already allowed (M10). Used to open
 * the map where the person is. The last known fix comes first because it is instant.
 */
export async function knownPosition(timeoutMs = 8_000): Promise<Position | null> {
  const permission = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (permission?.status !== "granted") return null;
  const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
  if (last) return { lat: last.coords.latitude, lng: last.coords.longitude };
  const fix = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const position = await Promise.race([fix, timeout]).catch(() => null);
  return position ? { lat: position.coords.latitude, lng: position.coords.longitude } : null;
}
