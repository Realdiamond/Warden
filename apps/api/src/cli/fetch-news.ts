// Reads the news feeds listed in WARDEN_NEWS_FEEDS and saves possible incidents for moderators.
// Run it every 30 to 60 minutes (docs/deploy.md):
//   WARDEN_NEWS_FEEDS="Outlet|https://outlet.example/feed" node apps/api/src/cli/fetch-news.ts

import { loadConfig } from "../config.ts";
import { createPool } from "../db/pool.ts";
import { fetchNews, parseNewsSources } from "../services/news.ts";

const sources = parseNewsSources(process.env.WARDEN_NEWS_FEEDS);
if (sources.length === 0) {
  console.error('Set WARDEN_NEWS_FEEDS to "Name|https://feed-url,Name|https://feed-url".');
  process.exit(1);
}
const config = loadConfig();
const pool = createPool(config.databaseUrl);
try {
  const result = await fetchNews({ pool, now: () => new Date() }, sources);
  for (const [name, outcome] of Object.entries(result)) {
    console.log(`${name}: ${typeof outcome === "number" ? `${outcome} new lead(s)` : outcome}`);
  }
} finally {
  await pool.end();
}
