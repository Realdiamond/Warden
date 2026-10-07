import { createPrivateKey, createPublicKey, randomBytes, sign } from "node:crypto";
import { broadcastSigningText, type PublicAlert, type SignedBroadcast } from "@warden/shared";
import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_PREFS, EMPTY_ALERT_STATE, processAlerts } from "./alerts.ts";
import { checkBroadcast, fromBase64 } from "./broadcasts.ts";

// The same key handling as the server (apps/api/src/signing.ts).
const seed = randomBytes(32);
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
  format: "der",
  type: "pkcs8",
});
const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
const publicKey = spki.subarray(spki.length - 32).toString("base64");

const NOW = new Date("2026-10-05T12:00:00Z");
const HOME = { name: "Home", lat: 6.5244, lng: 3.3792 };

function signed(overrides: Partial<SignedBroadcast> = {}): SignedBroadcast {
  const payload = {
    id: "8a1c2d3e-0000-4000-8000-000000000001",
    organisation: "Lagos State Emergency",
    tier: "warning" as const,
    center: { lat: 6.53, lng: 3.36 },
    radiusM: 10_000,
    message: "Flooding on Ikorodu Road. Avoid the area.",
    expiresAt: "2026-10-05T15:00:00.000Z",
    ...overrides,
  };
  const signature = sign(null, Buffer.from(broadcastSigningText(payload)), privateKey);
  return { ...payload, keyId: "s1", signature: signature.toString("base64") };
}

function asAlert(b: SignedBroadcast, id: string): PublicAlert {
  return {
    id,
    incidentId: null,
    kind: "broadcast",
    tier: b.tier,
    categoryId: null,
    label: null,
    center: b.center,
    message: b.message,
    source: b.organisation,
    visibleAt: "2026-10-05T11:58:00.000Z",
    broadcast: b,
  };
}

describe("broadcast signatures", () => {
  it("decodes base64 like Node does", () => {
    const bytes = randomBytes(37);
    expect(Buffer.from(fromBase64(bytes.toString("base64")))).toEqual(bytes);
  });

  it("verifies Warden's signature and rejects any change", () => {
    const b = signed();
    expect(checkBroadcast(b, publicKey)).toBe("verified");
    expect(checkBroadcast({ ...b, message: "All clear, go out." }, publicKey)).toBe("invalid");
    expect(checkBroadcast({ ...b, radiusM: 50_000 }, publicKey)).toBe("invalid");
    expect(checkBroadcast(b, randomBytes(32).toString("base64"))).toBe("invalid");
    expect(checkBroadcast(b, null)).toBe("unverified");
  });

  it("shows a broadcast once even though it arrives for several tiles, and drops forgeries", () => {
    const b = signed();
    const check = (alert: PublicAlert) =>
      alert.broadcast ? checkBroadcast(alert.broadcast, publicKey) : "invalid";
    const result = processAlerts(
      EMPTY_ALERT_STATE,
      [
        asAlert(b, "1_1"),
        asAlert(b, "1_2"),
        asAlert({ ...b, id: "8a1c2d3e-0000-4000-8000-000000000002", message: "Fake" }, "1_3"),
      ],
      [HOME],
      DEFAULT_ALERT_PREFS,
      NOW,
      check,
    );
    expect(result.state.inbox).toHaveLength(1);
    expect(result.state.inbox[0]?.verified).toBe(true);
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0]).toMatchObject({
      title: "Message from Lagos State Emergency",
      channel: "warning",
    });
    expect(result.notifications[0]?.body).not.toContain("not verified");
  });

  it("reaches places as far as the agency chose, and ignores expired broadcasts", () => {
    const wide = signed({ radiusM: 20_000, center: { lat: 6.65, lng: 3.38 } }); // ~14 km away
    const near = processAlerts(
      EMPTY_ALERT_STATE,
      [asAlert(wide, "2_1")],
      [HOME],
      DEFAULT_ALERT_PREFS,
      NOW,
    );
    expect(near.state.inbox).toHaveLength(1);
    const old = signed({ expiresAt: "2026-10-05T11:00:00.000Z" });
    const expired = processAlerts(
      EMPTY_ALERT_STATE,
      [asAlert(old, "2_2")],
      [HOME],
      DEFAULT_ALERT_PREFS,
      NOW,
    );
    expect(expired.state.inbox).toHaveLength(0);
  });
});
