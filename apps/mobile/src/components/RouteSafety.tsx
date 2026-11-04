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
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { describeDistance } from "../lib/alerts.ts";
import { categoryName, type Language, strings } from "../lib/i18n.ts";
import { currentPosition } from "../lib/location.ts";
import type { Palette } from "../lib/theme.ts";
import { Text } from "./text.tsx";
import { useStyles, useTheme } from "./theme.tsx";
import { IconTile, type Tone } from "./ui.tsx";

const LEVEL_TONE: Record<RouteScore["level"], Tone> = {
  calm: "primary",
  caution: "warning",
  avoid: "danger",
};

function levelColor(c: Palette, level: RouteScore["level"]): string {
  if (level === "calm") return c.primary;
  if (level === "caution") return c.warningText;
  return c.dangerText;
}

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
  const c = useTheme();
  const styles = useStyles(makeStyles);
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

  if (result === "loading") return <ActivityIndicator color={c.primary} />;
  if (result === null) return null;

  const title =
    result.level === "calm"
      ? t.routeCalm
      : result.level === "caution"
        ? t.routeCaution
        : t.routeAvoid;
  const color = levelColor(c, result.level);
  return (
    <View style={[styles.box, { borderColor: color }]}>
      <View style={styles.head}>
        <IconTile icon={LEVEL_ICON[result.level]} tone={LEVEL_TONE[result.level]} size={40} />
        <Text style={[styles.title, { color }]}>{title}</Text>
      </View>
      <Text style={styles.help}>
        {result.nearby.length === 0 ? t.routeNothing : t.routeBasis(result.nearby.length)}
      </Text>
      {result.nearby.slice(0, 3).map((item) => {
        const category = getCategory(item.categoryId);
        return (
          <Text key={item.id} style={styles.item}>
            <Text style={{ color }}>● </Text>
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

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    box: {
      padding: 16,
      gap: 8,
      borderRadius: 18,
      borderWidth: 2,
      backgroundColor: c.surface,
    },
    head: { flexDirection: "row", alignItems: "center", gap: 12 },
    title: { flex: 1, fontSize: 18, fontWeight: "800" },
    help: { color: c.muted, fontSize: 14, lineHeight: 20 },
    item: { color: c.text, fontSize: 15, lineHeight: 21 },
  });
