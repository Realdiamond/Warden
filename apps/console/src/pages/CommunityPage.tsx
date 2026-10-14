// Community feed moderation (M7): anonymous tips wait here until a moderator publishes or
// rejects them; posts hidden by flags come back here too. Moderators can also post a notice
// from the Warden team. Every decision is written to the audit log.

import { MAX_TIP_LENGTH, type ModeratorPost } from "@warden/shared";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { ReasonDialog } from "../components/ReasonDialog.tsx";
import { timeAgo } from "../format.ts";
import type { Point } from "../responder/PointPicker.tsx";

const PointPicker = lazy(() => import("../responder/PointPicker.tsx"));
const REFRESH_MS = 30_000;
const HOURS = [6, 12, 24, 72, 168];

type Pending = { post: ModeratorPost; action: "reject" | "remove" };

export function CommunityPage() {
  const [items, setItems] = useState<ModeratorPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<Pending | null>(null);
  const [body, setBody] = useState("");
  const [areaLabel, setAreaLabel] = useState("");
  const [hours, setHours] = useState(24);
  const [point, setPoint] = useState<Point | null>(null);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api.community.queue()).items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load community posts.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function decide(
    post: ModeratorPost,
    action: "publish" | "reject" | "remove",
    reason?: string,
  ) {
    try {
      await api.community.decide(post.id, action, reason);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    }
  }

  async function postNotice() {
    if (!point) return;
    setBusy(true);
    try {
      await api.community.notice({
        body: body.trim(),
        areaLabel: areaLabel.trim(),
        center: point,
        hours,
      });
      setBody("");
      setAreaLabel("");
      setPosted("Posted. It shows in the community feed for that area straight away.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The notice was not posted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Community</h1>
      <p className="muted">
        Tips are anonymous and shown only for an area a few kilometres across. Publish only what
        helps people stay safe. Reject anything that names, describes or locates a person, or that
        is a rumour.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {items === null && !error && <p className="page-message">Loading…</p>}
      {items?.length === 0 && <p className="page-message">No tips are waiting.</p>}
      {items && items.length > 0 && (
        <table className="queue">
          <thead>
            <tr>
              <th scope="col">Tip</th>
              <th scope="col">Sent</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {items.map((post) => (
              <tr key={post.id}>
                <td>
                  {post.body}
                  {post.warnings.map((warning) => (
                    <span key={warning} className="tag">
                      {warning}
                    </span>
                  ))}
                </td>
                <td>{timeAgo(post.createdAt)}</td>
                <td className="actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void decide(post, "publish")}
                  >
                    Publish
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setAsking({ post, action: post.flags > 0 ? "remove" : "reject" })
                    }
                  >
                    {post.flags > 0 ? "Remove" : "Reject"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Post a notice from the Warden team</h2>
      {posted && <p className="card">{posted}</p>}
      <form
        className="card form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void postNotice();
        }}
      >
        <label className="span-all">
          Notice ({body.length}/{MAX_TIP_LENGTH})
          <textarea
            value={body}
            maxLength={MAX_TIP_LENGTH}
            rows={3}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Polling units close at 2pm. Expect crowds around Ikeja."
          />
        </label>
        <label>
          Area name
          <input value={areaLabel} maxLength={60} onChange={(e) => setAreaLabel(e.target.value)} />
        </label>
        <label>
          Shown for
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h < 24 ? `${h} hours` : `${h / 24} day${h === 24 ? "" : "s"}`}
              </option>
            ))}
          </select>
        </label>
        <div className="span-all">
          <Suspense fallback={<p className="muted">Loading map…</p>}>
            <PointPicker value={point} onChange={setPoint} />
          </Suspense>
        </div>
        <button
          type="submit"
          className="primary"
          disabled={busy || !point || body.trim().length < 10 || areaLabel.trim().length < 2}
        >
          Post notice
        </button>
      </form>

      {asking && (
        <ReasonDialog
          title={asking.action === "remove" ? "Remove this post" : "Reject this tip"}
          confirmLabel={asking.action === "remove" ? "Remove" : "Reject"}
          required
          onCancel={() => setAsking(null)}
          onConfirm={(reason) => {
            const { post, action } = asking;
            setAsking(null);
            void decide(post, action, reason);
          }}
        />
      )}
    </section>
  );
}
