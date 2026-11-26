import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.ts";
import { randomToken, hashToken } from "../crypto.ts";
import type { PairResponse } from "../shared.ts";

const pairSchema = z.object({
  pairCode: z.string(),
  deviceName: z.string().min(1).max(100),
  platform: z.literal("android"),
  appVersion: z.string().min(1),
  // Consent is required: the monitored person agreed on the device. No consent → no activation.
  consentAcceptedAt: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), {
    message: "consentAcceptedAt must be a valid timestamp",
  }),
});

interface PairDeviceRow {
  id: string;
  pair_code_expires_at: string | null;
  paired_at: string | null;
}

export function registerPairingRoutes(app: FastifyInstance): void {
  // The monitored app redeems a pair code, recording consent, and receives a device token.
  app.post("/v1/pairing", async (req, reply) => {
    const parsed = pairSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", detail: parsed.error.flatten() });
    const { pairCode, deviceName, platform, appVersion, consentAcceptedAt } = parsed.data;

    const device = db
      .prepare("SELECT id, pair_code_expires_at, paired_at FROM devices WHERE pair_code = ?")
      .get(pairCode) as PairDeviceRow | undefined;

    if (!device) return reply.code(404).send({ error: "invalid_pair_code" });
    if (device.paired_at) return reply.code(409).send({ error: "already_paired" });
    if (
      !device.pair_code_expires_at ||
      new Date(device.pair_code_expires_at).getTime() < Date.now()
    ) {
      return reply.code(410).send({ error: "pair_code_expired" });
    }

    const token = randomToken();
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE devices
         SET name = ?, platform = ?, app_version = ?, device_token_hash = ?,
             paired_at = ?, consent_accepted_at = ?, last_seen_at = ?,
             pair_code = NULL, pair_code_expires_at = NULL
       WHERE id = ?`,
    ).run(deviceName, platform, appVersion, hashToken(token), now, consentAcceptedAt, now, device.id);

    const res: PairResponse = { deviceId: device.id, deviceToken: token };
    return reply.code(201).send(res);
  });
}
