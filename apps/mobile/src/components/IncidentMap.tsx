import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map as MapView,
  UserLocation,
} from "@maplibre/maplibre-react-native";
import type { PublicIncident } from "@warden/shared";
import { forwardRef, useMemo } from "react";
import { StyleSheet } from "react-native";
import { incidentsToGeoJSON } from "../lib/geo.ts";

/** Lagos, for the first launch before the phone's location is known. */
export const DEFAULT_CENTER: [number, number] = [3.3792, 6.5244];

interface Props {
  styleUrl: string;
  incidents: PublicIncident[];
  showUser: boolean;
  onRegionChange: (bounds: [number, number, number, number]) => void;
  onSelect: (id: string | null) => void;
}

export const IncidentMap = forwardRef<CameraRef, Props>(function IncidentMap(
  { styleUrl, incidents, showUser, onRegionChange, onSelect },
  cameraRef,
) {
  const data = useMemo(() => incidentsToGeoJSON(incidents), [incidents]);

  return (
    <MapView
      style={StyleSheet.absoluteFill}
      mapStyle={styleUrl}
      logo={false}
      compass={false}
      attribution
      attributionPosition={{ bottom: 96, left: 8 }}
      onPress={() => onSelect(null)}
      onRegionDidChange={(event) => onRegionChange(event.nativeEvent.bounds)}
    >
      <Camera ref={cameraRef} initialViewState={{ center: DEFAULT_CENTER, zoom: 11 }} />
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
