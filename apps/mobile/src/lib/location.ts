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
