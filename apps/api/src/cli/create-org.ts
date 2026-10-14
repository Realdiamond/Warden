// Creates a verified responder organisation.
//   pnpm --filter @warden/api create-org -- --name "Lagos State Police Command" --kind police \
//     --area lagos
// --area takes a built-in area (lagos, fct), --bbox minLng,minLat,maxLng,maxLat, or
// --geojson <file with a Polygon or MultiPolygon>. Leave all out for a national organisation.
// Only verify an organisation after checking it is real (PRD: responder onboarding).

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ORGANISATION_KINDS, type OrganisationKind } from "@warden/shared";
import { createPool } from "../db/pool.ts";
import { createOrganisation } from "../services/responders.ts";

/** Rough boxes for the launch areas; replace with official boundaries when available. */
const AREAS: Record<string, [number, number, number, number]> = {
  lagos: [2.69, 6.37, 4.35, 6.71],
  fct: [6.74, 8.4, 7.63, 9.36],
};

function box([minLng, minLat, maxLng, maxLat]: [number, number, number, number]) {
  return {
    type: "Polygon",
    coordinates: [
      [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ],
    ],
  };
}

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    kind: { type: "string" },
    area: { type: "string" },
    bbox: { type: "string" },
    geojson: { type: "string" },
  },
});

const url = process.env.DATABASE_URL;
const kind = values.kind as OrganisationKind | undefined;
if (!url || !values.name || !kind || !ORGANISATION_KINDS.includes(kind)) {
  console.error(
    `Usage: create-org --name <name> --kind <${ORGANISATION_KINDS.join("|")}> ` +
      "[--area lagos|fct | --bbox minLng,minLat,maxLng,maxLat | --geojson file]  (needs DATABASE_URL)",
  );
  process.exit(1);
}

let jurisdiction: unknown = null;
if (values.area) {
  const area = AREAS[values.area];
  if (!area) {
    console.error(`Unknown area ${values.area}; use ${Object.keys(AREAS).join(", ")}`);
    process.exit(1);
  }
  jurisdiction = box(area);
} else if (values.bbox) {
  const parts = values.bbox.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    console.error("--bbox must be minLng,minLat,maxLng,maxLat");
    process.exit(1);
  }
  jurisdiction = box(parts as [number, number, number, number]);
} else if (values.geojson) {
  const parsed = JSON.parse(readFileSync(values.geojson, "utf8")) as {
    type?: string;
    geometry?: unknown;
  };
  jurisdiction = parsed.type === "Feature" ? parsed.geometry : parsed;
}

const pool = createPool(url);
try {
  const { id } = await createOrganisation(
    pool,
    { name: values.name, kind, jurisdiction },
    new Date(),
  );
  console.log(`Created organisation ${id} (${values.name})`);
  console.log(`Next: create-staff --email <email> --role responder --org ${id}`);
} finally {
  await pool.end();
}
