// News leads (M8): headlines from the news feeds Warden follows, matched to a place in Nigeria.
// Nothing reaches the map until a moderator reads the story and adds it; it then shows as an
// unconfirmed incident for the whole area, linked to the story. Every decision is audited.

import { CATEGORIES, type CategoryId, getCategory, type NewsLead } from "@warden/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { ReasonDialog } from "../components/ReasonDialog.tsx";
import { timeAgo } from "../format.ts";

const PUBLIC_CATEGORIES = CATEGORIES.filter((c) => c.handling === "public");

function LeadRow({
  lead,
  onAdd,
  onDismiss,
}: {
  lead: NewsLead;
  onAdd: (categoryId: CategoryId) => void;
  onDismiss: () => void;
}) {
  const suggested = getCategory(lead.categoryId ?? "");
  const [categoryId, setCategoryId] = useState<string>(
    suggested?.handling === "public" ? suggested.id : "",
  );
  return (
    <tr>
      <td>
        <a href={lead.url} target="_blank" rel="noopener noreferrer">
          {lead.title}
        </a>
        {lead.summary && <p className="muted">{lead.summary}</p>}
        <p className="muted">
          {lead.source} · {timeAgo(lead.publishedAt ?? lead.createdAt)}
          {lead.place ? ` · ${lead.place}` : ""}
        </p>
      </td>
      <td>
        <select
          aria-label={`Kind of incident for ${lead.title}`}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Choose…</option>
          {PUBLIC_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </td>
      <td className="actions">
        <button
          type="button"
          className="primary"
          disabled={!categoryId}
          onClick={() => onAdd(categoryId as CategoryId)}
        >
          Add to map
        </button>
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      </td>
    </tr>
  );
}

export function NewsPage() {
  const [items, setItems] = useState<NewsLead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<NewsLead | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api.news.queue()).items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load news leads.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(lead: NewsLead, decision: Parameters<typeof api.news.decide>[1]) {
    setNotice(null);
    try {
      await api.news.decide(lead.id, decision);
      if (decision.action === "add") {
        setNotice("Added. It shows on the map as unconfirmed for the whole area.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    }
  }

  return (
    <section>
      <h1>News</h1>
      <p className="muted">
        Headlines from the news feeds Warden follows that mention a place in Nigeria. Read the story
        first. Add it only when it describes something that happened in the last day or two and
        people nearby should know. It will show as unconfirmed, for the area, never a street.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="card">{notice}</p>}
      {items === null && !error && <p className="page-message">Loading…</p>}
      {items?.length === 0 && <p className="page-message">No news leads are waiting.</p>}
      {items && items.length > 0 && (
        <table className="queue">
          <thead>
            <tr>
              <th scope="col">Story</th>
              <th scope="col">Kind</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {items.map((lead) => (
              <LeadRow
                key={lead.id}
                lead={lead}
                onAdd={(categoryId) => void decide(lead, { action: "add", categoryId })}
                onDismiss={() => setDismissing(lead)}
              />
            ))}
          </tbody>
        </table>
      )}
      {dismissing && (
        <ReasonDialog
          title="Dismiss this story"
          confirmLabel="Dismiss"
          required={false}
          onCancel={() => setDismissing(null)}
          onConfirm={(reason) => {
            const lead = dismissing;
            setDismissing(null);
            void decide(lead, reason ? { action: "dismiss", reason } : { action: "dismiss" });
          }}
        />
      )}
    </section>
  );
}
