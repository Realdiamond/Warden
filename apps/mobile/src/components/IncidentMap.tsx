import {
  Camera,
  type CameraRef,
  type CircleLayerSpecification,
  type FilterSpecification,
  GeoJSONSource,
  type GeoJSONSourceRef,
  Images,
  Layer,
  Map as MapView,
  UserLocation,
} from "@maplibre/maplibre-react-native";
import type { PublicIncident, PublicPresence } from "@warden/shared";
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { StyleSheet } from "react-native";
import { incidentsToGeoJSON, presenceToGeoJSON } from "../lib/geo.ts";
import { categoryName, type Language } from "../lib/i18n.ts";
import { incidentName, incidentPoints, presencePoints, shortAge } from "../lib/mapFeatures.ts";
import { MAP_ICONS } from "./mapIcons.ts";
import { useMapStyle, useTheme } from "./theme.tsx";

/** Lagos, for the first launch before the phone's location is known. */
export const DEFAULT_CENTER: [number, number] = [3.3792, 6.5244];
export const CITY_ZOOM = 11;
/** Close enough to see each incident on its own, about a neighbourhood across. */
export const STREET_ZOOM = 14;
/** Below this zoom, incidents group into numbered circles. */
const CLUSTER_MAX_ZOOM = 12;
/** A colour that can depend on each feature, in the map library's own types. */
type MapColor = NonNullable<NonNullable<CircleLayerSpecification["paint"]>["circle-color"]>;

/** Text on the map comes from the map style's own fonts. */
const MAP_FONT = ["Noto Sans Bold"];

export interface RegionChange {
  bounds: [number, number, number, number];
  zoom: number;
}

interface Props {
  incidents: PublicIncident[];
  presence: PublicPresence[];
  showUser: boolean;
  language: Language;
  initialCenter?: [number, number];
  initialZoom?: number;
  onRegionChange: (region: RegionChange) => void;
  onSelect: (id: string | null) => void;
  onSelectPresence: (id: string | null) => void;
}

export const IncidentMap = forwardRef<CameraRef, Props>(function IncidentMap(
  {
    incidents,
    presence,
    showUser,
    language,
    initialCenter = DEFAULT_CENTER,
    initialZoom = CITY_ZOOM,
    onRegionChange,
    onSelect,
    onSelectPresence,
  },
  ref,
) {
  const c = useTheme();
  const styleUrl = useMapStyle();
  const camera = useRef<CameraRef>(null);
  const points = useRef<GeoJSONSourceRef>(null);
  // Callers fly the camera (to an alert, to the person). The handle forwards each call to the
  // camera at call time, so a call made while the map is still starting is not lost.
  useImperativeHandle(
    ref,
    () =>
      new Proxy({} as CameraRef, {
        get: (_target, key) => {
          // Never look like a promise to code that awaits the handle.
          if (key === "then") return undefined;
          const method = camera.current?.[key as keyof CameraRef];
          return typeof method === "function"
            ? (...args: unknown[]) =>
                (method as (...a: unknown[]) => unknown).apply(camera.current, args)
            : () => undefined;
        },
      }),
    [],
  );

  const areas = useMemo(() => incidentsToGeoJSON(incidents), [incidents]);
  const markers = useMemo(() => {
    const now = Date.now();
    return incidentPoints(
      incidents,
      (incident) =>
        `${categoryName(incident.categoryId, incidentName(incident), language)} · ${shortAge(incident.lastReportAt, now)}`,
    );
  }, [incidents, language]);
  const presenceAreas = useMemo(() => presenceToGeoJSON(presence), [presence]);
  const presenceLabels = useMemo(() => presencePoints(presence), [presence]);

  // Emergency red, warning amber, advisory blue; markers also carry an icon, so colour is
  // never the only clue.
  const byRank: MapColor = ["match", ["get", "rank"], 3, c.critical, 2, c.warning, c.advisory];
  const byClusterRank: MapColor = [
    "match",
    ["get", "maxRank"],
    3,
    c.critical,
    2,
    c.warning,
    c.advisory,
  ];
  const bySeverity: MapColor = [
    "match",
    ["get", "severity"],
    "critical",
    c.critical,
    "high",
    c.warning,
    c.advisory,
  ];
  const ring = c.name === "dark" ? c.background : "#FFFFFF";
  const single: FilterSpecification = ["!", ["has", "point_count"]];
  const several: FilterSpecification = ["all", single, [">", ["get", "reports"], 1]];

  return (
    <MapView
      style={StyleSheet.absoluteFill}
      mapStyle={styleUrl}
      logo={false}
      compass={false}
      attribution
      attributionPosition={{ bottom: 124, left: 8 }}
      onPress={() => {
        onSelect(null);
        onSelectPresence(null);
      }}
      onRegionDidChange={(event) =>
        onRegionChange({ bounds: event.nativeEvent.bounds, zoom: event.nativeEvent.zoom })
      }
    >
      <Camera ref={camera} initialViewState={{ center: initialCenter, zoom: initialZoom }} />
      <Images images={MAP_ICONS} />

      <GeoJSONSource
        id="presence"
        data={presenceAreas}
        onPress={(event) => {
          const id = event.nativeEvent.features[0]?.properties?.id;
          onSelectPresence(typeof id === "string" ? id : null);
        }}
      >
        <Layer
          id="presence-fill"
          type="fill"
          paint={{ "fill-color": c.responder, "fill-opacity": 0.12 }}
        />
        <Layer
          id="presence-outline"
          type="line"
          paint={{ "line-color": c.responder, "line-width": 2, "line-dasharray": [2, 2] }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="presence-labels" data={presenceLabels}>
        <Layer
          id="presence-label"
          type="symbol"
          minzoom={12.5}
          layout={{
            "text-field": ["get", "title"],
            "text-font": MAP_FONT,
            "text-size": 12,
            "text-max-width": 10,
          }}
          paint={{
            "text-color": c.responderText,
            "text-halo-color": c.surface,
            "text-halo-width": 2,
          }}
        />
      </GeoJSONSource>

      <GeoJSONSource
        id="incident-areas"
        data={areas}
        onPress={(event) => {
          const id = event.nativeEvent.features[0]?.properties?.id;
          onSelect(typeof id === "string" ? id : null);
        }}
      >
        <Layer
          id="incident-area"
          type="fill"
          minzoom={CLUSTER_MAX_ZOOM}
          paint={{
            "fill-color": bySeverity,
            "fill-opacity": ["case", ["get", "active"], 0.18, 0.07],
          }}
        />
      </GeoJSONSource>

      <GeoJSONSource
        id="incidents"
        ref={points}
        data={markers}
        cluster
        clusterRadius={48}
        clusterMaxZoom={CLUSTER_MAX_ZOOM}
        clusterProperties={{ maxRank: ["max", ["get", "rank"]] }}
        onPress={(event) => {
          const feature = event.nativeEvent.features[0];
          const props = feature?.properties ?? {};
          if (typeof props.cluster_id === "number" && feature?.geometry.type === "Point") {
            const [lng, lat] = feature.geometry.coordinates as [number, number];
            void points.current
              ?.getClusterExpansionZoom(props.cluster_id)
              .then((zoom) => camera.current?.flyTo({ center: [lng, lat], zoom: zoom + 0.5 }))
              .catch(() => undefined);
            return;
          }
          onSelect(typeof props.id === "string" ? props.id : null);
        }}
      >
        <Layer
          id="cluster-circle"
          type="circle"
          filter={["has", "point_count"]}
          paint={{
            "circle-color": byClusterRank,
            "circle-radius": ["step", ["get", "point_count"], 20, 3, 24, 6, 28, 10, 32],
            "circle-stroke-width": 3,
            "circle-stroke-color": ring,
          }}
        />
        <Layer
          id="cluster-count"
          type="symbol"
          filter={["has", "point_count"]}
          layout={{
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": MAP_FONT,
            "text-size": 17,
            "text-allow-overlap": true,
          }}
          paint={{ "text-color": "#FFFFFF" }}
        />
        <Layer
          id="incident-circle"
          type="circle"
          filter={single}
          paint={{
            "circle-color": byRank,
            "circle-radius": ["case", ["==", ["get", "rank"], 3], 21, 18],
            "circle-stroke-width": 3,
            "circle-stroke-color": ring,
            "circle-opacity": ["case", ["==", ["get", "active"], 1], 1, 0.5],
            "circle-stroke-opacity": ["case", ["==", ["get", "active"], 1], 1, 0.5],
          }}
        />
        <Layer
          id="incident-icon"
          type="symbol"
          filter={single}
          layout={{
            "icon-image": ["get", "icon"],
            "icon-size": 0.85,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          }}
        />
        <Layer
          id="incident-count-badge"
          type="circle"
          filter={several}
          paint={{
            "circle-radius": 10,
            "circle-color": "#FFFFFF",
            "circle-translate": [15, -15],
            "circle-stroke-width": 1,
            "circle-stroke-color": byRank,
          }}
        />
        <Layer
          id="incident-count"
          type="symbol"
          filter={several}
          layout={{
            "text-field": ["to-string", ["get", "reports"]],
            "text-font": MAP_FONT,
            "text-size": 12,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{ "text-color": byRank, "text-translate": [15, -15] }}
        />
        <Layer
          id="incident-label"
          type="symbol"
          minzoom={12.5}
          filter={single}
          layout={{
            "text-field": ["get", "title"],
            "text-font": MAP_FONT,
            "text-size": 12,
            "text-anchor": "top",
            "text-offset": [0, 1.9],
            "text-max-width": 12,
            "text-optional": true,
          }}
          paint={{ "text-color": c.text, "text-halo-color": c.surface, "text-halo-width": 2 }}
        />
      </GeoJSONSource>
      {showUser ? <UserLocation /> : null}
    </MapView>
  );
});
