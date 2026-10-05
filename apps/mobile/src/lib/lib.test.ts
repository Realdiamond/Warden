import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { CATEGORIES } from "@warden/shared";
import { describe, expect, it } from "vitest";
import { WardenApi } from "./api.ts";
import { boundsToBBox, incidentsToGeoJSON } from "./geo.ts";
import { type KeyValueStore, Outbox, type Sender } from "./outbox.ts";
import { getInstallId, isValidServerUrl, loadSettings } from "./settings.ts";
import { demoSource } from "./source.ts";
import { GROUP_ICONS } from "./ui.ts";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
}

const body = {
  categoryId: "theft" as const,
  location: { lat: 6.5, lng: 3.4 },
  proximity: "here" as const,
};

describe("Outbox", () => {
  it("keeps reports while offline and sends them later with the same key", async () => {
    const outbox = new Outbox(memoryStore());
    await outbox.add(body, "key-1", new Date("2026-10-05T12:00:00Z"));

    const offline: Sender = async () => ({ ok: false, retry: true, message: "offline" });
    expect(await outbox.flush(offline)).toEqual({ sent: 0, rejected: 0, waiting: 1 });
    expect((await outbox.pending())[0]?.attempts).toBe(1);

    const keys: string[] = [];
    const online: Sender = async (_b, key) => {
      keys.push(key);
      return { ok: true, receipt: { reportId: "r1", statusToken: "t1", receivedAt: "x" } };
    };
    expect(await outbox.flush(online)).toEqual({ sent: 1, rejected: 0, waiting: 0 });
    expect(keys).toEqual(["key-1"]);
    expect(await outbox.pending()).toEqual([]);
    expect((await outbox.sent())[0]).toMatchObject({ reportId: "r1", categoryId: "theft" });
  });

  it("drops reports the server rejects for good and remembers why", async () => {
    const outbox = new Outbox(memoryStore());
    await outbox.add(body, "key-2", new Date());
    await outbox.flush(async () => ({
      ok: false,
      retry: false,
      message: "The location must be in Nigeria.",
    }));
    expect(await outbox.pending()).toEqual([]);
    expect((await outbox.rejected())[0]?.message).toContain("Nigeria");
  });

  it("runs one flush at a time", async () => {
    const outbox = new Outbox(memoryStore());
    await outbox.add(body, "key-3", new Date());
    let calls = 0;
    const slow: Sender = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { ok: true, receipt: { reportId: "r", statusToken: "t", receivedAt: "x" } };
    };
    await Promise.all([outbox.flush(slow), outbox.flush(slow)]);
    expect(calls).toBe(1);
  });

  it("clears history but never unsent reports", async () => {
    const store = memoryStore();
    const outbox = new Outbox(store);
    await outbox.add(body, "a", new Date());
    await outbox.flush(async () => ({
      ok: true,
      receipt: { reportId: "r", statusToken: "t", receivedAt: "x" },
    }));
    await outbox.add(body, "b", new Date());
    await outbox.clearHistory();
    expect(await outbox.sent()).toEqual([]);
    expect(await outbox.pending()).toHaveLength(1);
  });
});

describe("WardenApi", () => {
  it("sends the install id and idempotency key, never the phone's own position", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ reportId: "r", statusToken: "t", receivedAt: "x" }), {
        status: 201,
      });
    }) as unknown as typeof fetch;
    const api = new WardenApi("https://api.example.ng/", "install-1", fakeFetch);
    const result = await api.submitReport(body, "idem-1");
    expect(result.ok).toBe(true);
    expect(calls[0]?.url).toBe("https://api.example.ng/v1/reports");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["x-warden-install"]).toBe("install-1");
    expect(headers["idempotency-key"]).toBe("idem-1");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(body);
  });

  it("asks to retry on server errors and network failures, not on validation errors", async () => {
    const respond = (status: number) =>
      (async () =>
        new Response(JSON.stringify({ title: "nope" }), { status })) as unknown as typeof fetch;
    expect(
      await new WardenApi("https://x", "i", respond(503)).submitReport(body, "k"),
    ).toMatchObject({ retry: true });
    expect(
      await new WardenApi("https://x", "i", respond(422)).submitReport(body, "k"),
    ).toMatchObject({
      retry: false,
      message: "nope",
    });
    const failing = (async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch;
    expect(await new WardenApi("https://x", "i", failing).submitReport(body, "k")).toMatchObject({
      retry: true,
    });
  });
});

describe("geo helpers", () => {
  it("shrinks very large map views to what the API accepts", () => {
    const bbox = boundsToBBox([0, 0, 20, 20]);
    expect(bbox.maxLng - bbox.minLng).toBeLessThan(6);
    expect((bbox.minLng + bbox.maxLng) / 2).toBeCloseTo(10);
  });

  it("turns incidents into polygons for the map", async () => {
    const incidents = await demoSource().incidents(
      { minLng: 3, minLat: 6.3, maxLng: 3.8, maxLat: 6.8 },
      "7d",
    );
    const geojson = incidentsToGeoJSON(incidents);
    expect(geojson.features.length).toBeGreaterThan(5);
    expect(geojson.features[0]?.geometry.type).toBe("Polygon");
  });

  it("filters demo incidents by time window", async () => {
    const box = { minLng: 2.6, minLat: 4, maxLng: 8.6, maxLat: 10 };
    const sixHours = await demoSource().incidents(box, "6h");
    const week = await demoSource().incidents(box, "7d");
    expect(week.length).toBeGreaterThan(sixHours.length);
  });
});

describe("settings", () => {
  it("starts in demo mode when no server is built in", async () => {
    expect(await loadSettings(memoryStore(), "")).toEqual({ apiUrl: "", demoMode: true });
    expect(await loadSettings(memoryStore(), "https://api.warden.ng")).toEqual({
      apiUrl: "https://api.warden.ng",
      demoMode: false,
    });
  });

  it("accepts only https server addresses", () => {
    expect(isValidServerUrl("https://api.warden.ng")).toBe(true);
    expect(isValidServerUrl("http://192.168.1.10:8080")).toBe(false);
    expect(isValidServerUrl("ftp://x")).toBe(false);
    expect(isValidServerUrl("not a url")).toBe(false);
  });

  it("creates the install id once", async () => {
    const store = memoryStore();
    let n = 0;
    const make = () => `id-${++n}`;
    expect(await getInstallId(store, make)).toBe("id-1");
    expect(await getInstallId(store, make)).toBe("id-1");
  });
});

describe("icons", () => {
  it("uses only icon names that exist in the bundled icon font", () => {
    const require = createRequire(import.meta.url);
    const path = require.resolve(
      "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json",
    );
    const glyphs = JSON.parse(readFileSync(path, "utf8")) as Record<string, number>;
    const names = [...CATEGORIES.map((c) => c.icon), ...Object.values(GROUP_ICONS)];
    expect(names.filter((name) => !(name in glyphs))).toEqual([]);
  });
});
