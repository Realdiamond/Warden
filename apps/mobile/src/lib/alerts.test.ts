import type { PublicAlert } from "@warden/shared";
import { describe, expect, it } from "vitest";
import { checkAlerts } from "./alertCheck.ts";
import {
  type AlertPrefs,
  DEFAULT_ALERT_PREFS,
  EMPTY_ALERT_STATE,
  isQuietTime,
  limitNotifications,
  loadAlertState,
  MAX_NOTIFICATIONS_PER_CHECK,
  matchPlace,
  type PlannedNotification,
  processAlerts,
  saveAlertPrefs,
  tilesForPlaces,
} from "./alerts.ts";
import type { KeyValueStore } from "./outbox.ts";
import { savePlaces } from "./places.ts";
import { demoAlerts } from "./source.ts";

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
}

const HOME = { name: "Home", lat: 6.5244, lng: 3.3792 };
const NOW = new Date("2026-10-05T12:00:00Z");

let seq = 0;
function alert(overrides: Partial<PublicAlert> = {}): PublicAlert {
  seq += 1;
  return {
    id: `${NOW.getTime()}_${seq}`,
    incidentId: `incident-${seq}`,
    kind: "new",
    tier: "warning",
    categoryId: "armed_robbery",
    label: "Corroborated",
    // About 600 m north-east of home.
    center: { lat: 6.5284, lng: 3.3832 },
    message: null,
    source: null,
    visibleAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
    broadcast: null,
    ...overrides,
  };
}

const prefs = (changes: Partial<AlertPrefs> = {}): AlertPrefs => ({
  ...DEFAULT_ALERT_PREFS,
  ...changes,
});

describe("matching alerts to saved places", () => {
  it("matches within the tier's radius and picks the nearest place", () => {
    const work = { name: "Work", lat: 6.529, lng: 3.384 };
    expect(matchPlace(alert(), [HOME, work])?.place.name).toBe("Work");
    const far = alert({ center: { lat: 6.55, lng: 3.41 } }); // about 4.5 km away
    expect(matchPlace(far, [HOME])).toBeNull();
    expect(matchPlace({ ...far, tier: "critical" }, [HOME])).toBeNull();
    const twoKm = alert({ center: { lat: 6.5424, lng: 3.3792 } }); // 2.0 km north
    expect(matchPlace({ ...twoKm, tier: "critical" }, [HOME])).not.toBeNull();
    expect(matchPlace({ ...twoKm, tier: "advisory" }, [HOME])).toBeNull();
  });

  it("asks for nine tiles per place, shared tiles once", () => {
    expect(tilesForPlaces([HOME])).toHaveLength(9);
    expect(tilesForPlaces([HOME, { ...HOME, name: "Next door" }])).toHaveLength(9);
  });
});

describe("processing the feed", () => {
  it("adds matching alerts to the inbox and notifies once", () => {
    const a = alert();
    const first = processAlerts(EMPTY_ALERT_STATE, [a], [HOME], prefs(), NOW);
    expect(first.state.inbox).toHaveLength(1);
    expect(first.notifications).toHaveLength(1);
    expect(first.notifications[0]).toMatchObject({
      channel: "warning",
      title: "Warning: Armed robbery",
    });
    expect(first.notifications[0]?.body).toContain("Near Home");
    const again = processAlerts(first.state, [a], [HOME], prefs(), NOW);
    expect(again.notifications).toHaveLength(0);
    expect(again.state.inbox).toHaveLength(1);
  });

  it("keeps advisory alerts in the inbox without notifying unless switched on", () => {
    const a = alert({ tier: "advisory", categoryId: "theft", center: HOME });
    const off = processAlerts(EMPTY_ALERT_STATE, [a], [HOME], prefs(), NOW);
    expect(off.state.inbox).toHaveLength(1);
    expect(off.notifications).toHaveLength(0);
    const on = processAlerts(
      EMPTY_ALERT_STATE,
      [a],
      [HOME],
      prefs({ tiers: { warning: true, advisory: true } }),
      NOW,
    );
    expect(on.notifications).toHaveLength(1);
  });

  it("sends 'it's over' only to people who were told about the incident", () => {
    const resolved = alert({ kind: "resolved", incidentId: "x", label: "Resolved" });
    const stranger = processAlerts(EMPTY_ALERT_STATE, [resolved], [HOME], prefs(), NOW);
    expect(stranger.state.inbox).toHaveLength(0);

    const told = processAlerts(
      EMPTY_ALERT_STATE,
      [alert({ incidentId: "x" })],
      [HOME],
      prefs(),
      NOW,
    );
    const follow = processAlerts(told.state, [resolved], [HOME], prefs(), NOW);
    expect(follow.notifications[0]).toMatchObject({
      channel: "updates",
      title: "Over: Armed robbery",
    });
  });

  it("does not notify about old alerts, such as on the first check", () => {
    const old = alert({ visibleAt: new Date(NOW.getTime() - 4 * 3_600_000).toISOString() });
    const result = processAlerts(EMPTY_ALERT_STATE, [old], [HOME], prefs(), NOW);
    expect(result.state.inbox).toHaveLength(1);
    expect(result.notifications).toHaveLength(0);
  });

  it("goes quiet at night except for critical alerts", () => {
    const quiet = prefs({ quietHours: { enabled: true, startHour: 22, endHour: 6 } });
    const night = new Date(2026, 9, 5, 23, 30);
    const at = (d: Date) => new Date(d.getTime() - 60_000).toISOString();
    const result = processAlerts(
      EMPTY_ALERT_STATE,
      [
        alert({ visibleAt: at(night) }),
        alert({ tier: "critical", categoryId: "kidnapping", visibleAt: at(night) }),
      ],
      [HOME],
      { ...quiet, speak: true },
      night,
    );
    expect(result.notifications.map((n) => n.channel)).toEqual(["quiet", "critical"]);
    expect(result.notifications[0]?.speech).toBeNull();
    expect(result.notifications[1]?.speech).toContain("Danger: Kidnapping");
  });

  it("labels demo alerts as not real", () => {
    const result = processAlerts(
      EMPTY_ALERT_STATE,
      [alert({ source: "demo" })],
      [HOME],
      prefs(),
      NOW,
    );
    expect(result.notifications[0]?.body).toMatch(/^Demo, not real\./);
  });

  it("notifies nothing when alerts are switched off", () => {
    const result = processAlerts(
      EMPTY_ALERT_STATE,
      [alert()],
      [HOME],
      prefs({ enabled: false }),
      NOW,
    );
    expect(result.notifications).toHaveLength(0);
    expect(result.state.inbox).toHaveLength(1);
  });
});

describe("quiet hours and flood control", () => {
  it("handles windows that cross midnight and ones that do not", () => {
    const overnight = prefs({ quietHours: { enabled: true, startHour: 22, endHour: 6 } });
    expect(isQuietTime(overnight, new Date(2026, 0, 1, 23))).toBe(true);
    expect(isQuietTime(overnight, new Date(2026, 0, 1, 5))).toBe(true);
    expect(isQuietTime(overnight, new Date(2026, 0, 1, 6))).toBe(false);
    const afternoon = prefs({ quietHours: { enabled: true, startHour: 13, endHour: 15 } });
    expect(isQuietTime(afternoon, new Date(2026, 0, 1, 14))).toBe(true);
    expect(isQuietTime(afternoon, new Date(2026, 0, 1, 16))).toBe(false);
    expect(isQuietTime(prefs(), new Date(2026, 0, 1, 23))).toBe(false);
  });

  it("folds a burst into the most serious few plus a summary", () => {
    const planned: PlannedNotification[] = [
      "advisory",
      "critical",
      "warning",
      "advisory",
      "warning",
    ].map((channel, i) => ({
      alertId: String(i),
      incidentId: null,
      channel: channel as PlannedNotification["channel"],
      title: `n${i}`,
      body: "",
      speech: null,
    }));
    const shown = limitNotifications(planned);
    expect(shown).toHaveLength(MAX_NOTIFICATIONS_PER_CHECK);
    expect(shown[0]?.channel).toBe("critical");
    expect(shown.at(-1)?.title).toBe("3 more alerts near your places");
  });
});

describe("alert check", () => {
  it("fetches by tiles, keeps the cursor and starts afresh for a different server", async () => {
    const store = memoryStore();
    await savePlaces(store, [{ id: "1", kind: "home", ...HOME }]);
    await saveAlertPrefs(store, DEFAULT_ALERT_PREFS);
    const calls: Array<{ tiles: string[]; after: string | null }> = [];
    const a = alert();
    const fetchAlerts = async (tiles: string[], after: string | null) => {
      calls.push({ tiles, after });
      return after ? { alerts: [], cursor: after } : { alerts: [a], cursor: a.id };
    };

    const first = await checkAlerts({ store, feedId: "https://a", fetchAlerts, now: () => NOW });
    expect(first.notifications).toHaveLength(1);
    expect(calls[0]?.tiles).toHaveLength(9);
    expect((await loadAlertState(store)).cursor).toBe(a.id);

    await checkAlerts({ store, feedId: "https://a", fetchAlerts, now: () => NOW });
    expect(calls[1]?.after).toBe(a.id);

    await checkAlerts({ store, feedId: "https://b", fetchAlerts, now: () => NOW });
    expect(calls[2]?.after).toBeNull();
  });

  it("does nothing without saved places", async () => {
    const result = await checkAlerts({
      store: memoryStore(),
      feedId: "demo",
      fetchAlerts: async () => {
        throw new Error("should not fetch");
      },
      now: () => NOW,
    });
    expect(result.notifications).toHaveLength(0);
  });

  it("serves demo alerts once, for the asked tiles only", () => {
    const lagos = tilesForPlaces([HOME]);
    const first = demoAlerts(lagos, null, NOW.getTime());
    expect(first.alerts.length).toBeGreaterThan(0);
    expect(first.alerts.every((a) => a.source === "demo")).toBe(true);
    expect(demoAlerts(lagos, first.cursor, NOW.getTime()).alerts).toHaveLength(0);
    expect(
      demoAlerts(tilesForPlaces([{ name: "Kano", lat: 12, lng: 8.5 }]), null, 0).alerts,
    ).toHaveLength(0);
  });
});
