// Route safety score (M7) on the trip screen. Worked out on the phone from the public map, so
// where the person starts and where they are going never leave the phone.

import {
  type BBox,
  getCategory,
  MAX_BBOX_SPAN_DEG,
  type PublicIncident,
  publicLabelOf,
  type RouteScore,
  routeArea,
  routeScore,
} from "@warden/shared";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { describeDistance } from "../lib/alerts.ts";
import { categoryName, type Language, strings } from "../lib/i18n.ts";
import { currentPosition } from "../lib/location.ts";
import { COLORS } from "../lib/ui.ts";
import { Icon } from "./ui.tsx";

const LEVEL_COLOR = { calm: COLORS.primary, caution: "#B54708", avoid: COLORS.danger } as const;
const LEVEL_ICON = {
  calm: "shield-check",
  caution: "shield-alert",
  avoid: "alert-octagon",
} as const;

export function RouteSafety({
  destination,
  findIncidents,
  language,
}: {
  destination: { lat: number; lng: number };
  findIncidents: (bbox: BBox) => Promise<PublicIncident[]>;
  language: Language;
}) {
  const t = strings(language);
  const [result, setResult] = useState<RouteScore | null | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    setResult("loading");
    void (async () => {
      const here = await currentPosition();
      if (!here) {
        if (!cancelled) setResult(null);
        return;
      }
      const area = routeArea(here, destination);
      if (
        area.maxLat - area.minLat > MAX_BBOX_SPAN_DEG ||
        area.maxLng - area.minLng > MAX_BBOX_SPAN_DEG
      ) {
        // Long journeys between cities: the map cannot be loaded in one go.
        if (!cancelled) setResult(null);
        return;
      }
      const incidents = await findIncidents(area).catch(() => null);
      if (cancelled) return;
      setResult(incidents ? routeScore(incidents, here, destination, new Date()) : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [destination, findIncidents]);

  if (result === "loading") return <ActivityIndicator color={COLORS.primary} />;
  if (result === null) return null;

  const title =
    result.level === "calm"
      ? t.routeCalm
      : result.level === "caution"
        ? t.routeCaution
        : t.routeAvoid;
  return (
    <View style={[styles.box, { borderColor: LEVEL_COLOR[result.level] }]}>
      <View style={styles.head}>
        <Icon name={LEVEL_ICON[result.level]} color={LEVEL_COLOR[result.level]} />
        <Text style={[styles.title, { color: LEVEL_COLOR[result.level] }]}>{title}</Text>
      </View>
      <Text style={styles.help}>
        {result.nearby.length === 0 ? t.routeNothing : t.routeBasis(result.nearby.length)}
      </Text>
      {result.nearby.slice(0, 3).map((item) => {
        const category = getCategory(item.categoryId);
        return (
          <Text key={item.id} style={styles.item}>
            {categoryName(
              item.categoryId,
              category ? publicLabelOf(category) : item.categoryId,
              language,
            )}{" "}
            · {describeDistance(item.distanceM, language)}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: 14, gap: 6, borderRadius: 14, borderWidth: 2, backgroundColor: COLORS.surface },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 17, fontWeight: "700" },
  help: { color: COLORS.muted, fontSize: 13 },
  item: { color: COLORS.text },
});
