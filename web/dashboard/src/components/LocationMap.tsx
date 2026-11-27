import { useEffect, useRef } from "react";
import L from "leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

const icon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export interface Point {
  lat: number;
  lon: number;
  capturedAt: string;
}

export function LocationMap({ points }: { points: Point[] }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: true }).setView(
      [9.082, 8.6753],
      6,
    ); // Nigeria overview
    // Standard OSM tiles, recolored dark via CSS filter (no API key required, unlike hosted dark
    // basemaps such as CartoDB's, which now gate free tiles behind an account).
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
      className: "map-tiles-dark",
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (points.length === 0) return;

    const latlngs = points.map((p) => [p.lat, p.lon] as [number, number]);
    L.polyline(latlngs, { color: "#7c6cf6", weight: 3, opacity: 0.6 }).addTo(layer);

    const latest = points[0];
    L.marker([latest.lat, latest.lon], { icon })
      .addTo(layer)
      .bindPopup(`Latest fix: ${new Date(latest.capturedAt).toLocaleString()}`);
    map.setView([latest.lat, latest.lon], 15);
  }, [points]);

  return <div ref={elRef} className="map" data-testid="map" />;
}
