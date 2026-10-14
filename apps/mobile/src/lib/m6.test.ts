import { CHECK_IN_WINDOW_MS, ROUTE_SUSTAIN_MS, type SessionPoint } from "@warden/shared";
import { describe, expect, it } from "vitest";
import { alertTitle, describeDistance } from "./alerts.ts";
import { WardenApi } from "./api.ts";
import { categoryName, LANGUAGES, strings } from "./i18n.ts";
import {
  type ActiveSession,
  answerRouteCheck,
  checkInOverdue,
  loadPendingFlags,
  retryPendingFlags,
  routeWatchFor,
  sendOrQueueFlag,
  shareText,
  watchRoute,
} from "./safety.ts";
import { isValidReporterCode, normaliseReporterCode } from "./settings.ts";
import { demoSource } from "./source.ts";

const LEKKI = { lat: 6.45, lng: 3.4 };

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: async (key: string) => {
      data.delete(key);
    },
  };
}
const START = new Date("2026-10-01T08:00:00Z").getTime();

function trip(): ActiveSession {
  return {
    sessionId: "s",
    controlToken: "c",
    kind: "trip",
    viewUrl: null,
    feedId: "f",
    startedAt: new Date(START).toISOString(),
    expectedArrivalAt: null,
    destinationLabel: "Lekki",
    pending: [],
    lastSentAt: null,
    route: routeWatchFor("trip", LEKKI),
    checkIn: null,
  };
}

/** A point `km` north of Lekki, `minutes` into the trip. */
function point(km: number, minutes: number): SessionPoint {
  return {
    lat: LEKKI.lat + km / 111,
    lng: LEKKI.lng,
    accuracyM: 20,
    at: new Date(START + minutes * 60_000).toISOString(),
  };
}

describe("off-route check on the phone", () => {
  it("asks once after the person keeps moving away, then waits for an answer", () => {
    let session = trip();
    // Heading towards the destination: no question.
    let result = watchRoute(session, [point(10, 0), point(8, 5), point(6, 10)], new Date(START));
    expect(result.ask).toBe(false);
    session = result.session;

    // Turned back and kept going for longer than the sustain time.
    const minutes = 10 + ROUTE_SUSTAIN_MS / 60_000;
    const asked = new Date(START + (minutes + 1) * 60_000);
    result = watchRoute(session, [point(8, 11), point(9, 11), point(9.5, minutes + 1)], asked);
    expect(result.ask).toBe(true);
    session = result.session;
    expect(session.checkIn?.dueAt).toBe(
      new Date(asked.getTime() + CHECK_IN_WINDOW_MS).toISOString(),
    );

    // Further away still: no second question.
    expect(watchRoute(session, [point(11, minutes + 2)], asked).ask).toBe(false);

    expect(checkInOverdue(session, asked)).toBe(false);
    expect(checkInOverdue(session, new Date(asked.getTime() + CHECK_IN_WINDOW_MS))).toBe(true);
    const flagged = {
      ...session,
      checkIn: session.checkIn && { ...session.checkIn, flagged: true },
    };
    expect(checkInOverdue(flagged, new Date(asked.getTime() + CHECK_IN_WINDOW_MS))).toBe(false);

    // "I'm OK": the detour is accepted from here, so going on from here asks nothing.
    const answered = answerRouteCheck(session, point(11, minutes + 3));
    expect(answered.checkIn).toBeNull();
    expect(answered.route?.asked).toBe(false);
    expect(watchRoute(answered, [point(10, minutes + 4)], asked).ask).toBe(false);
  });

  it("drops an unanswered question when the person arrives, but not one contacts were told about", () => {
    let session = trip();
    session = watchRoute(session, [point(10, 0), point(6, 10)], new Date(START)).session;
    const asked = watchRoute(session, [point(9, 11), point(9.5, 16)], new Date(START)).session;
    expect(asked.checkIn).not.toBeNull();
    const arrived = watchRoute(asked, [point(0, 30)], new Date(START)).session;
    expect(arrived.checkIn).toBeNull();
    const told = { ...asked, checkIn: asked.checkIn && { ...asked.checkIn, flagged: true } };
    expect(watchRoute(told, [point(0, 30)], new Date(START)).session.checkIn?.flagged).toBe(true);
  });

  it("keeps flags that could not be sent and retries them in order", async () => {
    const store = memoryStore();
    const flag = (reason: "duress" | "ok") => ({ sessionId: "s", controlToken: "c", reason });
    expect(await sendOrQueueFlag(store, flag("duress"), async () => false)).toBe(false);
    expect(
      await sendOrQueueFlag(store, flag("ok"), async () => {
        throw new Error("offline");
      }),
    ).toBe(false);
    expect((await loadPendingFlags(store)).map((f) => f.reason)).toEqual(["duress", "ok"]);

    // The duress flag goes; "ok" fails again and is kept.
    expect(await retryPendingFlags(store, async (f) => f.reason === "duress")).toBe(1);
    expect((await loadPendingFlags(store)).map((f) => f.reason)).toEqual(["ok"]);
    expect(await retryPendingFlags(store, async () => true)).toBe(1);
    expect(await loadPendingFlags(store)).toEqual([]);
  });

  it("does nothing for SOS, trips without a destination, or older saved trips", () => {
    expect(routeWatchFor("sos", LEKKI)).toBeNull();
    expect(routeWatchFor("trip", undefined)).toBeNull();
    const old = { ...trip(), route: undefined, checkIn: undefined };
    expect(watchRoute(old, [point(5, 0), point(50, 60)], new Date(START)).ask).toBe(false);
    expect(checkInOverdue(old, new Date(START))).toBe(false);
  });
});

describe("Pidgin", () => {
  it("has every phrase in every language", () => {
    for (const language of LANGUAGES) {
      const t = strings(language);
      for (const [key, value] of Object.entries(strings("en"))) {
        expect(typeof (t as unknown as Record<string, unknown>)[key], key).toBe(typeof value);
      }
    }
  });

  it("writes alerts, distances and SOS messages in Pidgin", () => {
    expect(describeDistance(400, "pcm")).toBe("like 400 m");
    expect(categoryName("burglary", "Burglary", "pcm")).toBe("Dem break house");
    expect(categoryName("burglary", "Burglary", "en")).toBe("Burglary");
    const title = alertTitle(
      {
        id: "a",
        kind: "incident",
        categoryId: "armed_robbery",
        label: "Unconfirmed",
        severity: "critical",
      } as unknown as Parameters<typeof alertTitle>[0],
      "pcm",
    );
    expect(title).toContain("Armed robbery");
    expect(shareText("sos", "Ada", "https://w/s/1", "pcm")).toContain("If you no fit reach me");
    expect(shareText("sos", "Ada", "https://w/s/1")).toContain("If you cannot reach me");
  });
});

describe("trusted reporter code", () => {
  it("accepts the code however it is typed", () => {
    expect(normaliseReporterCode("abcde-fghjk mnpqr-stuvw")).toBe("ABCDEFGHJKMNPQRSTUVW");
    expect(isValidReporterCode("abcde-fghjk-mnpqr-stuvw")).toBe(true);
    expect(isValidReporterCode("")).toBe(true);
    expect(isValidReporterCode("ABCDE-FGHJK")).toBe(false);
    expect(isValidReporterCode("ABCDE-FGHJK-MNPQR-STUV1")).toBe(false);
  });

  it("sends the code with reports only when there is one", async () => {
    const seen: Array<Record<string, string>> = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return new Response(JSON.stringify({ reportId: "r", statusToken: "t", receivedAt: "x" }), {
        status: 201,
      });
    }) as unknown as typeof fetch;
    const body = { categoryId: "theft", location: LEKKI, proximity: "here" } as const;
    await new WardenApi("https://x", "i", fakeFetch, "ABCDEFGHJKMNPQRSTUVW").submitReport(
      body,
      "k",
    );
    await new WardenApi("https://x", "i", fakeFetch).submitReport(body, "k");
    expect(seen[0]?.["x-warden-reporter-code"]).toBe("ABCDEFGHJKMNPQRSTUVW");
    expect(seen[1]).not.toHaveProperty("x-warden-reporter-code");
  });
});

describe("safe places in demo mode", () => {
  it("lists the sample places in the area asked for", async () => {
    const lagos = await demoSource().safeStops({
      minLng: 3.2,
      minLat: 6.3,
      maxLng: 3.7,
      maxLat: 6.8,
    });
    expect(lagos.length).toBeGreaterThan(0);
    expect(lagos.every((s) => s.name.startsWith("Demo"))).toBe(true);
    expect(
      await demoSource().safeStops({ minLng: 13, minLat: 13, maxLng: 13.5, maxLat: 13.5 }),
    ).toEqual([]);
  });
});
