import type { ModeratorReport } from "@warden/shared";
import { cellBoundary } from "@warden/shared/geo";
import { LngLatBounds, Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 runs its tile parser in a worker; let Vite bundle it and tell MapLibre where it is.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";

setWorkerUrl(workerUrl);

const STYLE_URL =
  import.meta.env.VITE_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";

/**
 * Moderator-only map: the public area (H3 cell) and the exact report points. The exact points
 * are Restricted data and never appear in any public view.
 */
export function IncidentMap({ cell, reports }: { cell: string; reports: ModeratorReport[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!container.current) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: container.current,
        style: STYLE_URL,
        attributionControl: { compact: true },
      });
    } catch {
      setFailed(true);
      return;
    }

    const ring = cellBoundary(cell);
    const bounds = new LngLatBounds();
    for (const [lng, lat] of ring) bounds.extend([lng, lat]);
    for (const report of reports) bounds.extend([report.location.lng, report.location.lat]);
    map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });

    map.on("error", () => setFailed(true));
    map.on("load", () => {
      map.addSource("area", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [ring] },
        },
      });
      map.addLayer({
        id: "area-fill",
        type: "fill",
        source: "area",
        paint: { "fill-color": "#c2410c", "fill-opacity": 0.18 },
      });
      map.addLayer({
        id: "area-line",
        type: "line",
        source: "area",
        paint: { "line-color": "#c2410c", "line-width": 2 },
      });
      map.addSource("reports", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: reports.map((report) => ({
            type: "Feature",
            properties: { id: report.id },
            geometry: { type: "Point", coordinates: [report.location.lng, report.location.lat] },
          })),
        },
      });
      map.addLayer({
        id: "report-points",
        type: "circle",
        source: "reports",
        paint: {
          "circle-radius": 6,
          "circle-color": "#1d4ed8",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
    });

    return () => map.remove();
  }, [cell, reports]);

  return (
    <div className="map-wrap">
      <div
        ref={container}
        className="map"
        role="img"
        aria-label="Map of the incident area and report points"
      />
      {failed && <p className="map-note">The map could not load. Coordinates are listed below.</p>}
      <p className="map-legend">
        <span className="swatch area" /> Public area <span className="swatch point" /> Exact report
        location (staff only)
      </p>
    </div>
  );
}
