import { MAX_MEDIA_PER_REPORT, type ReportSubmission } from "@warden/shared";
import { describe, expect, it } from "vitest";
import { WardenApi } from "./api.ts";
import { outlooksToGeoJSON } from "./geo.ts";
import {
  type Attachment,
  attachmentProblem,
  MAX_UPLOAD_ATTEMPTS,
  MediaQueue,
  type MediaUpload,
  outcomeForStatus,
  type UploadOutcome,
} from "./media.ts";
import { type KeyValueStore, Outbox } from "./outbox.ts";
import { demoSource } from "./source.ts";

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

function tracker() {
  const removed: string[] = [];
  return { removed, remove: async (uri: string) => void removed.push(uri) };
}

const body: ReportSubmission = {
  categoryId: "theft",
  location: { lat: 6.5, lng: 3.4 },
  proximity: "here",
};
const photo: Attachment = {
  uri: "file:///p.jpg",
  contentType: "image/jpeg",
  kind: "photo",
  bytes: 9,
};
const voice: Attachment = {
  uri: "file:///v.m4a",
  contentType: "audio/mp4",
  kind: "audio",
  bytes: 9,
};

function clip(n: number): MediaUpload {
  return {
    id: `c${n}`,
    target: "session",
    sessionId: "s",
    controlToken: "t",
    recordedAt: "2026-10-14T10:00:00Z",
    uri: `file:///c${n}.m4a`,
    contentType: "audio/mp4",
    attempts: 0,
  };
}

describe("report attachments", () => {
  it("checks the kind, the size and how many", () => {
    expect(attachmentProblem({ contentType: "image/jpeg", bytes: 500_000 }, 0)).toBeNull();
    expect(attachmentProblem({ contentType: "image/png", bytes: 10 }, 0)).toMatch(/cannot be sent/);
    expect(attachmentProblem({ contentType: "video/mp4", bytes: 9_000_000 }, 0)).toMatch(/shorter/);
    expect(
      attachmentProblem({ contentType: "audio/mp4", bytes: 10 }, MAX_MEDIA_PER_REPORT),
    ).toMatch(/up to 3/);
  });

  it("sends files only after the report is accepted, with its status token", async () => {
    const files = tracker();
    const media = new MediaQueue(memoryStore(), files.remove);
    let n = 0;
    const outbox = new Outbox(memoryStore(), media, () => `m${++n}`);
    await outbox.add(body, "k1", new Date(), [photo, voice]);

    await outbox.flush(async () => ({ ok: false, retry: true, message: "offline" }));
    expect(await media.pending()).toEqual([]);
    expect((await outbox.pending())[0]?.attachments).toHaveLength(2);

    await outbox.flush(async () => ({
      ok: true,
      receipt: { reportId: "r1", statusToken: "tok", receivedAt: "x" },
    }));
    expect(await media.pending()).toEqual([
      expect.objectContaining({ id: "m1", target: "report", reportId: "r1", statusToken: "tok" }),
      expect.objectContaining({ id: "m2", uri: voice.uri, contentType: "audio/mp4" }),
    ]);

    const sent: string[] = [];
    const result = await media.flush(async (item) => {
      sent.push(item.uri);
      return "sent";
    });
    expect(result).toEqual({ sent: 2, refused: 0, waiting: 0 });
    expect(sent).toEqual([photo.uri, voice.uri]);
    // Deleted from the phone once the server has them.
    expect(files.removed).toEqual([photo.uri, voice.uri]);
  });

  it("deletes the files of a report the server refuses", async () => {
    const files = tracker();
    const media = new MediaQueue(memoryStore(), files.remove);
    const outbox = new Outbox(memoryStore(), media);
    await outbox.add(body, "k2", new Date(), [photo]);
    await outbox.flush(async () => ({ ok: false, retry: false, message: "Not in Nigeria" }));
    expect(await media.pending()).toEqual([]);
    expect(files.removed).toEqual([photo.uri]);
  });
});

describe("media queue", () => {
  it("keeps files while offline and stops trying after the first failure", async () => {
    const files = tracker();
    const queue = new MediaQueue(memoryStore(), files.remove);
    await queue.add([clip(1), clip(2)]);
    let calls = 0;
    const offline = async (): Promise<UploadOutcome> => {
      calls += 1;
      return "retry";
    };
    expect(await queue.flush(offline)).toEqual({ sent: 0, refused: 0, waiting: 2 });
    expect(calls).toBe(1);
    expect((await queue.pending()).map((i) => i.attempts)).toEqual([1, 0]);
    expect(files.removed).toEqual([]);
  });

  it("drops a file the server refuses, and gives up after many tries", async () => {
    const files = tracker();
    const queue = new MediaQueue(memoryStore(), files.remove);
    await queue.add([{ ...clip(1), attempts: MAX_UPLOAD_ATTEMPTS - 1 }, clip(2)]);
    expect(await queue.flush(async (item) => (item.id === "c2" ? "refused" : "retry"))).toEqual({
      sent: 0,
      refused: 1,
      waiting: 1,
    });
    // c2 was never tried (offline after c1), so it waits.
    expect((await queue.pending()).map((i) => i.id)).toEqual(["c2"]);
    expect(await queue.flush(async () => "refused")).toEqual({ sent: 0, refused: 1, waiting: 0 });
    expect(files.removed).toEqual(["file:///c1.m4a", "file:///c2.m4a"]);
  });

  it("keeps files added while sending", async () => {
    const queue = new MediaQueue(memoryStore(), async () => undefined);
    await queue.add([clip(1)]);
    let release: () => void = () => undefined;
    const running = queue.flush(
      () =>
        new Promise<UploadOutcome>((resolve) => {
          release = () => resolve("sent");
        }),
    );
    await new Promise((r) => setTimeout(r, 5));
    await queue.add([clip(2)]);
    release();
    await running;
    expect((await queue.pending()).map((i) => i.id)).toEqual(["c2"]);
  });

  it("holds at most 40 SOS clips, dropping the oldest", async () => {
    const files = tracker();
    const queue = new MediaQueue(memoryStore(), files.remove);
    await queue.add(Array.from({ length: 45 }, (_, i) => clip(i)));
    const pending = await queue.pending();
    expect(pending).toHaveLength(40);
    expect(pending[0]?.id).toBe("c5");
    expect(files.removed).toHaveLength(5);
  });

  it("can be wiped on a shared phone", async () => {
    const files = tracker();
    const queue = new MediaQueue(memoryStore(), files.remove);
    await queue.add([clip(1)]);
    await queue.clear();
    expect(await queue.pending()).toEqual([]);
    expect(files.removed).toEqual(["file:///c1.m4a"]);
  });

  it("retries on server trouble only", () => {
    expect(outcomeForStatus(201)).toBe("sent");
    expect(outcomeForStatus(429)).toBe("retry");
    expect(outcomeForStatus(503)).toBe("retry");
    expect(outcomeForStatus(404)).toBe("refused");
    expect(outcomeForStatus(413)).toBe("refused");
  });
});

describe("WardenApi media", () => {
  it("sends report files with the status token and SOS clips with the control token", async () => {
    const calls: Array<{ url: string; uri: string; headers: Record<string, string> }> = [];
    const api = new WardenApi("https://api.example.ng", "install-1");
    const sendFile = async (url: string, uri: string, headers: Record<string, string>) => {
      calls.push({ url, uri, headers });
      return 201;
    };
    const report: MediaUpload = {
      id: "m1",
      target: "report",
      reportId: "r 1",
      statusToken: "tok",
      uri: "file:///p.jpg",
      contentType: "image/jpeg",
      attempts: 0,
    };
    expect(await api.uploadMedia(report, sendFile)).toBe("sent");
    expect(await api.uploadMedia(clip(1), sendFile)).toBe("sent");
    expect(calls[0]).toEqual({
      url: "https://api.example.ng/v1/reports/r%201/media",
      uri: "file:///p.jpg",
      headers: { "x-warden-status-token": "tok", "content-type": "image/jpeg" },
    });
    expect(calls[1]?.url).toBe("https://api.example.ng/v1/sessions/s/audio");
    expect(calls[1]?.headers).toEqual({
      "x-warden-session-control": "t",
      "x-warden-recorded-at": "2026-10-14T10:00:00Z",
      "content-type": "audio/mp4",
    });
    // Never the install id: files are tied to the report, not the phone.
    expect(JSON.stringify(calls)).not.toContain("install-1");
    const failing = async () => {
      throw new Error("Network request failed");
    };
    expect(await api.uploadMedia(report, failing)).toBe("retry");
  });
});

describe("area outlook", () => {
  it("shades demo areas on the map by level", async () => {
    const { outlooks } = await demoSource().outlook({
      minLng: 3,
      minLat: 6.3,
      maxLng: 3.8,
      maxLat: 6.8,
    });
    expect(outlooks.length).toBeGreaterThan(0);
    const geojson = outlooksToGeoJSON(outlooks);
    expect(geojson.features[0]?.properties).toMatchObject({ level: "elevated" });
    const first = geojson.features[0];
    if (!first) throw new Error("no areas");
    const ring = (first.geometry as GeoJSON.Polygon).coordinates[0] ?? [];
    expect(ring[0]).toEqual(ring.at(-1));
  });
});
