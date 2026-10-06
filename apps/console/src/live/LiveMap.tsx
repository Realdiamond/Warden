import type { SessionView } from "@warden/shared";
import type { Feature, FeatureCollection } from "geojson";
import { type GeoJSONSource, LngLatBounds, Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";

setWorkerUrl(workerUrl);

const STYLE_URL =
  import.meta.env.VITE_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";

type Collection = FeatureCollection;

function features(view: SessionView): { track: Collection; points: Collection } {
  const points: Feature[] = [];
  if (view.lastPoint) {
    points.push({
      type: "Feature",
      properties: { role: "person" },
      geometry: { type: "Point", coordinates: [view.lastPoint.lng, view.lastPoint.lat] },
    });
  }
  if (view.destination) {
    points.push({
      type: "Feature",
      properties: { role: "destination" },
      geometry: { type: "Point", coordinates: [view.destination.lng, view.destination.lat] },
    });
  }
  return {
    track: {
      type: "FeatureCollection",
      features:
        view.track.length > 1
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: view.track },
              },
            ]
          : [],
    },
    points: { type: "FeatureCollection", features: points },
  };
}

export default function LiveMap({ view }: { view: SessionView }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const fitted = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!container.current) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: container.current,
        style: STYLE_URL,
        center: [3.3792, 6.5244],
        zoom: 11,
        attributionControl: { compact: true },
      });
    } catch {
      setFailed(true);
      return;
    }
    map.on("error", () => setFailed(true));
    map.on("load", () => {
      map.addSource("track", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("points", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "track",
        type: "line",
        source: "track",
        paint: { "line-color": "#0f5c4d", "line-width": 4, "line-opacity": 0.7 },
      });
      map.addLayer({
        id: "points",
        type: "circle",
        source: "points",
        paint: {
          "circle-radius": ["match", ["get", "role"], "person", 9, 7],
          "circle-color": ["match", ["get", "role"], "person", "#b42318", "#0f5c4d"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
        },
      });
      mapRef.current = map;
    });
    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const update = () => {
      const map = mapRef.current;
      if (!map) return;
      const data = features(view);
      (map.getSource("track") as GeoJSONSource | undefined)?.setData(data.track);
      (map.getSource("points") as GeoJSONSource | undefined)?.setData(data.points);
      const target = view.lastPoint ?? view.destination;
      if (!target) return;
      if (!fitted.current) {
        const bounds = new LngLatBounds();
        for (const [lng, lat] of view.track) bounds.extend([lng, lat]);
        bounds.extend([target.lng, target.lat]);
        if (view.destination) bounds.extend([view.destination.lng, view.destination.lat]);
        map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
        fitted.current = true;
      } else if (view.lastPoint) {
        map.easeTo({ center: [view.lastPoint.lng, view.lastPoint.lat] });
      }
    };
    update();
    const map = mapRef.current;
    if (!map) {
      // The map is still loading; update once it is ready.
      const timer = setInterval(() => {
        if (mapRef.current) {
          clearInterval(timer);
          update();
        }
      }, 250);
      return () => clearInterval(timer);
    }
  }, [view]);

  if (failed) {
    return (
      <div className="live-map live-map-empty">
        The map could not load. Use "Open in maps" below.
      </div>
    );
  }
  return (
    <div ref={container} className="live-map" role="img" aria-label="Map of the shared location" />
  );
}
