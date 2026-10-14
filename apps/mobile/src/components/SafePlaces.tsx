// Nearby safe places (M6): police stations, hospitals and other public places, closest first,
// with a button that opens directions in the phone's maps app.

import { nearestStops, SAFE_STOP_LABELS, type SafeStop } from "@warden/shared";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { describeDistance } from "../lib/alerts.ts";
import { type Language, strings } from "../lib/i18n.ts";
import { currentPosition, type Position } from "../lib/location.ts";
import { COLORS } from "../lib/ui.ts";
import { Icon } from "./ui.tsx";

const ICONS: Record<SafeStop["kind"], string> = {
  police: "police-badge",
  hospital: "hospital-building",
  clinic: "medical-bag",
  pharmacy: "pill",
  fuel: "gas-station",
  fire: "fire-truck",
  other: "map-marker-check",
};

/** Roughly 10 km around the person. */
const SEARCH_DEG = 0.09;

export function directionsUrl(stop: SafeStop): string {
  return `geo:${stop.lat},${stop.lng}?q=${stop.lat},${stop.lng}(${encodeURIComponent(stop.name)})`;
}

export function SafePlaces({
  findStops,
  language,
  count = 4,
}: {
  findStops: (around: Position) => Promise<SafeStop[]>;
  language: Language;
  count?: number;
}) {
  const t = strings(language);
  const [openFailed, setOpenFailed] = useState<SafeStop | null>(null);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "done"; stops: Array<SafeStop & { distanceM: number }> }
    | { kind: "failed" }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const here = await currentPosition();
      if (!here) {
        if (!cancelled) setState({ kind: "failed" });
        return;
      }
      const stops = await findStops(here).catch(() => null);
      if (cancelled) return;
      setState(
        stops ? { kind: "done", stops: nearestStops(stops, here, count) } : { kind: "failed" },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [findStops, count]);

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t.safePlaces}</Text>
      <Text style={styles.help}>{t.safePlacesHelp}</Text>
      {state.kind === "loading" && <ActivityIndicator color={COLORS.primary} />}
      {(state.kind === "failed" || (state.kind === "done" && state.stops.length === 0)) && (
        <Text style={styles.help}>{t.noSafePlaces}</Text>
      )}
      {state.kind === "done" &&
        state.stops.map((stop) => (
          <Pressable
            key={stop.id}
            accessibilityRole="button"
            accessibilityLabel={`${t.directions}: ${stop.name}`}
            onPress={() => {
              setOpenFailed(null);
              Linking.openURL(directionsUrl(stop)).catch(() => setOpenFailed(stop));
            }}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Icon name={ICONS[stop.kind]} color={COLORS.primary} />
            <View style={styles.rowText}>
              <Text style={styles.name}>{stop.name}</Text>
              <Text style={styles.help}>
                {SAFE_STOP_LABELS[stop.kind]} · {describeDistance(stop.distanceM, language)}
                {stop.open24h ? ` · ${t.open24h}` : ""}
                {stop.verified ? "" : ` · ${t.notChecked}`}
              </Text>
            </View>
            <Icon name="directions" color={COLORS.primary} />
          </Pressable>
        ))}
      {openFailed && (
        <Text style={styles.help}>
          {t.noMapsApp(
            openFailed.name,
            `${openFailed.lat.toFixed(5)}, ${openFailed.lng.toFixed(5)}`,
          )}
        </Text>
      )}
    </View>
  );
}

/** Builds the search area for {@link SafePlaces} around a position. */
export function areaAround(here: Position) {
  return {
    minLat: here.lat - SEARCH_DEG,
    maxLat: here.lat + SEARCH_DEG,
    minLng: here.lng - SEARCH_DEG,
    maxLng: here.lng + SEARCH_DEG,
  };
}

const styles = StyleSheet.create({
  box: {
    padding: 16,
    gap: 8,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  title: { fontSize: 17, fontWeight: "700", color: COLORS.text },
  help: { color: COLORS.muted, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  rowText: { flex: 1 },
  name: { fontSize: 15, fontWeight: "600", color: COLORS.text },
  pressed: { opacity: 0.6 },
});
