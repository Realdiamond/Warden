import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { displayPhone, inviteText, makeContact, type TrustedContact } from "./contacts.ts";
import type { KeyValueStore } from "./outbox.ts";
import { checkPin, setUpPins } from "./pin.ts";
import {
  type ActiveSession,
  addPendingEnd,
  flushPoints,
  loadPendingEnds,
  minutesLeft,
  queuePoints,
  retryPendingEnds,
  shareText,
} from "./safety.ts";

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

const sha = async (text: string) => createHash("sha256").update(text).digest("hex");

const session: ActiveSession = {
  sessionId: "s1",
  controlToken: "t1",
  kind: "trip",
  viewUrl: "https://warden.ng/live#s1.v",
  feedId: "https://warden.ng",
  startedAt: "2026-10-05T12:00:00Z",
  expectedArrivalAt: "2026-10-05T12:30:00Z",
  destinationLabel: "Home",
  pending: [],
  lastSentAt: null,
};

const point = (i: number) => ({
  lat: 6.5,
  lng: 3.4,
  at: new Date(1_790_000_000_000 + i * 1000).toISOString(),
});

describe("trusted contacts", () => {
  it("accepts Nigerian numbers once each, up to five", () => {
    const list: TrustedContact[] = [];
    const first = makeContact(list, { id: "1", name: " Mum ", phone: "0803 123 4567" });
    expect(first).toEqual({
      ok: true,
      contact: { id: "1", name: "Mum", phone: "+2348031234567", invited: false },
    });
    if (first.ok) list.push(first.contact);
    expect(makeContact(list, { id: "2", name: "Dup", phone: "+2348031234567" }).ok).toBe(false);
    expect(makeContact(list, { id: "3", name: "Bad", phone: "12345" }).ok).toBe(false);
    expect(makeContact(list, { id: "4", name: "", phone: "08091234567" }).ok).toBe(false);
    expect(displayPhone("+2348031234567")).toBe("0803 123 4567");
    expect(inviteText("Ada")).toContain("it's Ada");
  });
});

describe("PINs", () => {
  it("tells the real PIN, the duress PIN and a wrong PIN apart", async () => {
    const setup = await setUpPins({ pin: "2468", duressPin: "1357" }, "salt", sha);
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;
    expect(JSON.stringify(setup.pins)).not.toContain("2468");
    expect(await checkPin(setup.pins, "2468", sha)).toBe("ok");
    expect(await checkPin(setup.pins, "1357", sha)).toBe("duress");
    expect(await checkPin(setup.pins, "0000", sha)).toBe("wrong");
    expect(await checkPin(null, "2468", sha)).toBe("none");
  });

  it("rejects weak or clashing PINs", async () => {
    expect((await setUpPins({ pin: "12", duressPin: "" }, "s", sha)).ok).toBe(false);
    expect((await setUpPins({ pin: "1234", duressPin: "1234" }, "s", sha)).ok).toBe(false);
    expect((await setUpPins({ pin: "1234", duressPin: "12a4" }, "s", sha)).ok).toBe(false);
    expect((await setUpPins({ pin: "1234", duressPin: "" }, "s", sha)).ok).toBe(true);
  });
});

describe("location queue", () => {
  it("sends in batches and keeps what fails", async () => {
    const queued = queuePoints(
      session,
      Array.from({ length: 120 }, (_, i) => point(i)),
    );
    const sizes: number[] = [];
    let calls = 0;
    const result = await flushPoints(
      queued,
      async (_id, _token, batch) => {
        calls += 1;
        sizes.push(batch.length);
        return calls < 3 ? { ok: true } : { ok: false, ended: false };
      },
      new Date(),
    );
    expect(sizes).toEqual([50, 50, 20]);
    expect(result.session.pending).toHaveLength(20);
    expect(result.ended).toBe(false);
  });

  it("reports when the server has ended the session", async () => {
    const result = await flushPoints(
      queuePoints(session, [point(1)]),
      async () => ({ ok: false, ended: true }),
      new Date(),
    );
    expect(result.ended).toBe(true);
  });

  it("caps the queue so a long time offline cannot fill the phone", () => {
    const queued = queuePoints(
      session,
      Array.from({ length: 700 }, (_, i) => point(i)),
    );
    expect(queued.pending).toHaveLength(500);
    expect(queued.pending[0]?.at).toBe(point(200).at);
  });

  it("works out time left and the share text", () => {
    expect(minutesLeft(session, new Date("2026-10-05T12:10:00Z"))).toBe(20);
    expect(minutesLeft(session, new Date("2026-10-05T12:45:00Z"))).toBe(-15);
    expect(shareText("sos", "Ada", session.viewUrl)).toContain("SOS: I need help");
    expect(shareText("trip", "Ada", session.viewUrl)).toContain(session.viewUrl);
  });
});

describe("stops sent later", () => {
  it("keeps a stop (including a duress stop) until the server hears it", async () => {
    const store = memoryStore();
    await addPendingEnd(store, {
      sessionId: "s1",
      controlToken: "t",
      outcome: "cancelled",
      duress: true,
    });
    expect(await retryPendingEnds(store, async () => false)).toBe(0);
    expect(await loadPendingEnds(store)).toHaveLength(1);
    const seen: boolean[] = [];
    expect(
      await retryPendingEnds(store, async (end) => {
        seen.push(end.duress);
        return true;
      }),
    ).toBe(1);
    expect(seen).toEqual([true]);
    expect(await loadPendingEnds(store)).toHaveLength(0);
  });
});
