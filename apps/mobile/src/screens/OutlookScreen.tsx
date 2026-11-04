// Area outlook (M8): how often serious things were reported in each area on the map over the
// last three months, and when. Plain counts, not a prediction about any person or street; areas
// with only a few reports are left blank on purpose.

import { Camera, GeoJSONSource, Layer, Map as MapView } from "@maplibre/maplibre-react-native";
import {
  type BBox,
  describeOutlook,
  OUTLOOK_MIN_INCIDENTS,
  type PublicAreaOutlook,
} from "@warden/shared";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../components/text.tsx";
import { useMapStyle, useStyles, useTheme } from "../components/theme.tsx";
import { IconTile, ModalHeader, Note, type Tone } from "../components/ui.tsx";
import { outlooksToGeoJSON } from "../lib/geo.ts";
import type { DataSource } from "../lib/source.ts";
import { MONO, type Palette } from "../lib/theme.ts";

type Level = PublicAreaOutlook["level"];

const LEVEL_LABEL = { elevated: "Many reports", moderate: "Some reports", low: "Few reports" };
const LEVEL_TONE: Record<Level, Tone> = { elevated: "danger", moderate: "warning", low: "primary" };

/** Area colour on the map. */
function levelFill(c: Palette, level: Level): string {
  if (level === "elevated") return c.critical;
  if (level === "moderate") return c.warning;
  return c.primary;
}

/** The same colour for words on a card. */
function levelText(c: Palette, level: Level): string {
  if (level === "elevated") return c.dangerText;
  if (level === "moderate") return c.warningText;
  return c.primary;
}

export function OutlookScreen({
  source,
  bbox,
  onClose,
}: {
  source: DataSource;
  bbox: BBox;
  onClose: () => void;
}) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const mapStyle = useMapStyle();
  const [outlooks, setOutlooks] = useState<PublicAreaOutlook[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // The map area when the screen opened; later pans of the main map do not reload it.
  const [area] = useState(bbox);

  useEffect(() => {
    let cancelled = false;
    source
      .outlook(area)
      .then((response) => {
        if (!cancelled) setOutlooks(response.outlooks);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [source, area]);

  const data = useMemo(() => outlooksToGeoJSON(outlooks ?? []), [outlooks]);
  const chosen = outlooks?.find((o) => o.cell === selected) ?? null;
  const center: [number, number] = [
    (area.minLng + area.maxLng) / 2,
    (area.minLat + area.maxLat) / 2,
  ];

  return (
    <View style={styles.screen}>
      <ModalHeader title="Area outlook" onClose={onClose} />
      <View style={styles.map}>
        <MapView
          style={StyleSheet.absoluteFill}
          mapStyle={mapStyle}
          logo={false}
          compass={false}
          attribution
          onPress={() => setSelected(null)}
        >
          <Camera initialViewState={{ center, zoom: 10 }} />
          <GeoJSONSource
            id="outlooks"
            data={data}
            onPress={(event) => {
              const cell = event.nativeEvent.features[0]?.properties?.cell;
              setSelected(typeof cell === "string" ? cell : null);
            }}
          >
            <Layer
              id="outlook-fill"
              type="fill"
              paint={{
                "fill-color": [
                  "match",
                  ["get", "level"],
                  "elevated",
                  levelFill(c, "elevated"),
                  "moderate",
                  levelFill(c, "moderate"),
                  levelFill(c, "low"),
                ],
                "fill-opacity": c.name === "dark" ? 0.4 : 0.3,
              }}
            />
            <Layer
              id="outlook-outline"
              type="line"
              paint={{ "line-color": c.muted, "line-width": 1, "line-opacity": 0.6 }}
            />
          </GeoJSONSource>
        </MapView>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {outlooks === null && !failed && <ActivityIndicator color={c.primary} />}
        {failed && <Note tone="warning">Could not load the outlook. Check your connection.</Note>}
        {chosen ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <IconTile icon="chart-timeline-variant" tone={LEVEL_TONE[chosen.level]} size={40} />
              <Text style={[styles.level, { color: levelText(c, chosen.level) }]}>
                {LEVEL_LABEL[chosen.level]} ·{" "}
                <Text style={[styles.count, { color: levelText(c, chosen.level) }]}>
                  {chosen.incidents}
                </Text>{" "}
                in 3 months
              </Text>
            </View>
            <Text style={styles.text}>{describeOutlook(chosen)}</Text>
          </View>
        ) : (
          outlooks && (
            <Text style={styles.text}>
              {outlooks.length === 0
                ? "No area here has enough reports for an outlook."
                : "Tap a shaded area to see how often serious things were reported there, and when."}
            </Text>
          )
        )}
        <Note icon="information-outline">
          Counts of incidents shown on Warden's map in the last 3 months, in areas a few kilometres
          across. Areas with fewer than {OUTLOOK_MIN_INCIDENTS} are left blank. This is not a
          prediction and says nothing about the people who live there.
        </Note>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    map: {
      height: 320,
      marginHorizontal: 16,
      borderRadius: 20,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: c.border,
    },
    body: { padding: 16, gap: 12 },
    card: {
      padding: 16,
      gap: 8,
      borderRadius: 18,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    cardHead: { flexDirection: "row", alignItems: "center", gap: 12 },
    level: { flex: 1, fontSize: 18, fontWeight: "800" },
    count: { fontFamily: MONO, fontSize: 18, fontWeight: "700" },
    text: { color: c.text, fontSize: 16, lineHeight: 22 },
  });
