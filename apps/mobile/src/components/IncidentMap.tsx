import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map as MapView,
  UserLocation,
} from "@maplibre/maplibre-react-native";
import type { PublicIncident, PublicPresence } from "@warden/shared";
import { forwardRef, useMemo } from "react";
import { StyleSheet } from "react-native";
import { incidentsToGeoJSON, presenceToGeoJSON } from "../lib/geo.ts";

export const PRESENCE_COLOR = "#5B21B6";

/** Lagos, for the first launch before the phone's location is known. */
export const DEFAULT_CENTER: [number, number] = [3.3792, 6.5244];

interface Props {
  styleUrl: string;
  incidents: PublicIncident[];
  presence: PublicPresence[];
  showUser: boolean;
  onRegionChange: (bounds: [number, number, number, number]) => void;
  onSelect: (id: string | null) => void;
  onSelectPresence: (id: string | null) => void;
}

export const IncidentMap = forwardRef<CameraRef, Props>(function IncidentMap(
  { styleUrl, incidents, presence, showUser, onRegionChange, onSelect, onSelectPresence },
  cameraRef,
) {
  const data = useMemo(() => incidentsToGeoJSON(incidents), [incidents]);
  const presenceData = useMemo(() => presenceToGeoJSON(presence), [presence]);

  return (
    <MapView
      style={StyleSheet.absoluteFill}
      mapStyle={styleUrl}
      logo={false}
      compass={false}
      attribution
      attributionPosition={{ bottom: 96, left: 8 }}
      onPress={() => {
        onSelect(null);
        onSelectPresence(null);
      }}
      onRegionDidChange={(event) => onRegionChange(event.nativeEvent.bounds)}
    >
      <Camera ref={cameraRef} initialViewState={{ center: DEFAULT_CENTER, zoom: 11 }} />
      <GeoJSONSource
        id="presence"
        data={presenceData}
        onPress={(event) => {
          const id = event.nativeEvent.features[0]?.properties?.id;
          onSelectPresence(typeof id === "string" ? id : null);
        }}
      >
        <Layer
          id="presence-fill"
          type="fill"
          paint={{ "fill-color": PRESENCE_COLOR, "fill-opacity": 0.15 }}
        />
        <Layer
          id="presence-outline"
          type="line"
          paint={{ "line-color": PRESENCE_COLOR, "line-width": 2, "line-dasharray": [2, 2] }}
        />
      </GeoJSONSource>
      <GeoJSONSource
        id="incidents"
        data={data}
        onPress={(event) => {
          const feature = event.nativeEvent.features[0];
          const id = feature?.properties?.id;
          onSelect(typeof id === "string" ? id : null);
        }}
      >
        <Layer
          id="incident-fill"
          type="fill"
          paint={{
            "fill-color": [
              "match",
              ["get", "severity"],
              "critical",
              "#B42318",
              "high",
              "#C2410C",
              "#2563EB",
            ],
            "fill-opacity": ["case", ["get", "active"], 0.38, 0.12],
          }}
        />
        <Layer
          id="incident-outline"
          type="line"
          paint={{
            "line-color": [
              "match",
              ["get", "severity"],
              "critical",
              "#B42318",
              "high",
              "#C2410C",
              "#2563EB",
            ],
            "line-width": 2,
            "line-opacity": ["case", ["get", "active"], 0.9, 0.35],
          }}
        />
      </GeoJSONSource>
      {showUser ? <UserLocation /> : null}
    </MapView>
  );
});
