// Imports safe stops (police stations, hospitals, fuel stations...) from a GeoJSON file.
//   pnpm --filter @warden/api import-safe-stops -- --file lagos-osm.geojson --source osm
//   pnpm --filter @warden/api import-safe-stops -- --file partner.geojson --source partner --verified
// An OpenStreetMap export (for example from overpass-turbo.eu, "amenity" in police, hospital,
// clinic, pharmacy, fuel, fire_station, exported as GeoJSON) works as it is. Partner files give
// each point a "kind" and "name". Running it again updates the same places.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createPool } from "../db/pool.ts";
import { importSafeStops, stopsFromGeoJson } from "../services/safeStops.ts";

const SOURCES = ["osm", "partner", "manual"] as const;
const { values } = parseArgs({
  options: {
    file: { type: "string" },
    source: { type: "string", default: "osm" },
    verified: { type: "boolean", default: false },
  },
});
const source = SOURCES.find((s) => s === values.source);
if (!values.file || !source) {
  console.error(
    "Usage: import-safe-stops --file <geojson> [--source osm|partner|manual] [--verified]",
  );
  process.exit(1);
}

const { stops, skipped } = stopsFromGeoJson(JSON.parse(readFileSync(values.file, "utf8")));
const config = loadConfig();
const pool = createPool(config.databaseUrl);
try {
  const count = await importSafeStops({ pool, now: () => new Date() }, source, stops, {
    verified: values.verified,
    actor: "import-safe-stops",
  });
  console.log(`Imported ${count} safe stops from ${source}; skipped ${skipped} other features.`);
} finally {
  await pool.end();
}
