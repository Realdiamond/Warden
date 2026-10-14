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
import Constants from "expo-constants";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { ModalHeader, Note } from "../components/ui.tsx";
import { outlooksToGeoJSON } from "../lib/geo.ts";
import type { DataSource } from "../lib/source.ts";
import { COLORS } from "../lib/ui.ts";

const extra = (Constants.expoConfig?.extra ?? {}) as { mapStyleUrl?: string };
const MAP_STYLE_URL = extra.mapStyleUrl ?? "https://tiles.openfreemap.org/styles/liberty";

export const LEVEL_COLOR = { elevated: "#B42318", moderate: "#C2410C", low: "#15803D" } as const;
const LEVEL_LABEL = { elevated: "Many reports", moderate: "Some reports", low: "Few reports" };

export function OutlookScreen({
  source,
  bbox,
  onClose,
}: {
  source: DataSource;
  bbox: BBox;
  onClose: () => void;
}) {
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
          mapStyle={MAP_STYLE_URL}
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
                  LEVEL_COLOR.elevated,
                  "moderate",
                  LEVEL_COLOR.moderate,
                  LEVEL_COLOR.low,
                ],
                "fill-opacity": 0.3,
              }}
            />
            <Layer
              id="outlook-outline"
              type="line"
              paint={{ "line-color": "#334155", "line-width": 1, "line-opacity": 0.5 }}
            />
          </GeoJSONSource>
        </MapView>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {outlooks === null && !failed && <ActivityIndicator color={COLORS.primary} />}
        {failed && <Note tone="warning">Could not load the outlook. Check your connection.</Note>}
        {chosen ? (
          <View style={styles.card}>
            <Text style={[styles.level, { color: LEVEL_COLOR[chosen.level] }]}>
              {LEVEL_LABEL[chosen.level]} · {chosen.incidents} in 3 months
            </Text>
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
        <Note>
          Counts of incidents shown on Warden's map in the last 3 months, in areas a few kilometres
          across. Areas with fewer than {OUTLOOK_MIN_INCIDENTS} are left blank. This is not a
          prediction and says nothing about the people who live there.
        </Note>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  map: { height: 320 },
  body: { padding: 16, gap: 12 },
  card: {
    padding: 14,
    gap: 6,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  level: { fontSize: 16, fontWeight: "700" },
  text: { color: COLORS.text, fontSize: 15 },
});
