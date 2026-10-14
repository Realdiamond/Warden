import { type Map as MapLibreMap, Map as MapView, Marker, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";

setWorkerUrl(workerUrl);

const STYLE_URL =
  import.meta.env.VITE_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";

export interface Point {
  lat: number;
  lng: number;
}

/** Click the map to choose a point; the numbers can also be typed if the map cannot load. */
export default function PointPicker({
  value,
  onChange,
}: {
  value: Point | null;
  onChange: (point: Point) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!container.current) return;
    let map: MapLibreMap;
    try {
      map = new MapView({
        container: container.current,
        style: STYLE_URL,
        center: [3.3792, 6.5244],
        zoom: 10,
        attributionControl: { compact: true },
      });
    } catch {
      setFailed(true);
      return;
    }
    map.on("error", () => setFailed(true));
    map.on("click", (event) => {
      changeRef.current({
        lat: Number(event.lngLat.lat.toFixed(6)),
        lng: Number(event.lngLat.lng.toFixed(6)),
      });
    });
    mapRef.current = map;
    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !value) return;
    if (!markerRef.current) markerRef.current = new Marker({ color: "#b42318" });
    markerRef.current.setLngLat([value.lng, value.lat]).addTo(map);
  }, [value]);

  const set = (key: "lat" | "lng", text: string) => {
    const number = Number(text);
    if (Number.isFinite(number))
      onChange({ lat: value?.lat ?? 0, lng: value?.lng ?? 0, [key]: number });
  };

  return (
    <div className="point-picker">
      {failed ? (
        <p className="map-note">The map could not load. Type the coordinates instead.</p>
      ) : (
        <div
          ref={container}
          className="picker-map"
          role="img"
          aria-label="Click to choose a place"
        />
      )}
      <div className="coords">
        <label>
          Latitude
          <input
            type="number"
            step="0.000001"
            value={value?.lat ?? ""}
            onChange={(e) => set("lat", e.target.value)}
          />
        </label>
        <label>
          Longitude
          <input
            type="number"
            step="0.000001"
            value={value?.lng ?? ""}
            onChange={(e) => set("lng", e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
