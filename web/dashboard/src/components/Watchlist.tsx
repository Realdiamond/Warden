import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { Eye, Plus, X, Phone } from "lucide-react";
import { api, ApiError, type WatchGroup, type WatchTerm } from "../api";
import { appName, avatarHue, dayLabel, initial, shortTime, pluralize } from "../lib/format";

/** Wrap every case-insensitive occurrence of `term` (incl. inside a word) in <mark>. */
function highlight(text: string | undefined, term: string): ReactNode {
  if (!text) return text ?? "";
  const t = term.trim().toLowerCase();
  if (!t) return text;
  const lower = text.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let idx = lower.indexOf(t, i);
  let k = 0;
  while (idx !== -1) {
    if (idx > i) out.push(text.slice(i, idx));
    out.push(<mark key={k++}>{text.slice(idx, idx + t.length)}</mark>);
    i = idx + t.length;
    idx = lower.indexOf(t, i);
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

/** A term made only of digits/phone punctuation is shown as a "number" chip. */
function termKind(term: string): "number" | "text" {
  return /^[\d\s()+\-.]+$/.test(term) && /\d/.test(term) ? "number" : "text";
}

export function Watchlist({ deviceId }: { deviceId: string }) {
  const [terms, setTerms] = useState<WatchTerm[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [groups, setGroups] = useState<WatchGroup[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTerms = useCallback(async () => {
    try {
      const { terms } = await api.listWatchTerms(deviceId);
      setTerms(terms);
      setSelected((cur) => cur ?? terms[0]?.term ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : "load_failed");
    }
  }, [deviceId]);

  useEffect(() => {
    loadTerms();
  }, [loadTerms]);

  // Load matches whenever the selected term changes.
  useEffect(() => {
    if (!selected) {
      setGroups(null);
      return;
    }
    let live = true;
    setLoading(true);
    api
      .getWatchMatches(deviceId, selected)
      .then((r) => {
        if (!live) return;
        setGroups(r.groups);
        setTotal(r.totalMatches);
      })
      .catch(() => live && setGroups([]))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [deviceId, selected]);

  async function addTerm(e: React.FormEvent) {
    e.preventDefault();
    const term = input.trim();
    if (!term || adding) return;
    setAdding(true);
    try {
      await api.addWatchTerm(deviceId, term);
      setInput("");
      await loadTerms();
      setSelected(term);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "add_failed");
    } finally {
      setAdding(false);
    }
  }

  async function removeTerm(t: WatchTerm) {
    await api.deleteWatchTerm(deviceId, t.id).catch(() => undefined);
    if (selected === t.term) setSelected(null);
    await loadTerms();
  }

  return (
    <section className="panel" data-testid="watchlist">
      <div className="panel-head">
        <Eye size={18} />
        <h2>Watchlist</h2>
        {terms.length > 0 && <span className="panel-head-meta">{pluralize(terms.length, "term")}</span>}
      </div>

      <p className="muted" style={{ marginBottom: "0.9rem" }}>
        Add a name, number or keyword. Anything matching it — in chats or calls — is collected here,
        organised per chat. Nothing is sent as an alert; it just waits for you.
      </p>

      <form className="wl-add" onSubmit={addTerm}>
        <div className="search-box wl-input">
          <Plus size={16} />
          <input
            type="text"
            aria-label="Add watch term"
            placeholder="Add a name, number or keyword…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <button className="primary" type="submit" disabled={!input.trim() || adding}>
          {adding ? "Adding…" : "Add"}
        </button>
      </form>

      {terms.length > 0 && (
        <div className="wl-chips" role="group" aria-label="Watch terms">
          {terms.map((t) => (
            <span
              key={t.id}
              className={`wl-chip ${selected === t.term ? "active" : ""} ${termKind(t.term)}`}
            >
              <button className="wl-chip-label" onClick={() => setSelected(t.term)}>
                {t.term}
              </button>
              <button className="wl-chip-x" aria-label={`Remove ${t.term}`} onClick={() => removeTerm(t)}>
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {terms.length === 0 ? (
        <p className="panel-empty">
          No watch terms yet. Add a name, a number or a keyword above to start collecting matches.
        </p>
      ) : !selected ? (
        <p className="panel-empty">Pick a term above to see its matches.</p>
      ) : loading ? (
        <div className="wl-results">
          <div className="skel skel-line" style={{ width: "40%" }} />
          <div className="skel skel-block" />
        </div>
      ) : !groups || groups.length === 0 ? (
        <p className="panel-empty">
          Nothing has matched <strong>“{selected}”</strong> yet.
        </p>
      ) : (
        <div className="wl-results" data-testid="wl-results">
          <div className="wl-summary">
            Showing <strong>“{selected}”</strong> — <strong>{pluralize(total, "match", "matches")}</strong>{" "}
            across <strong>{pluralize(groups.length, "chat")}</strong>
          </div>
          {groups.map((g) => (
            <div key={g.key} className="wl-group">
              <div className="wl-ghead">
                {g.kind === "call" ? (
                  <span className="wl-badge call">
                    <Phone size={15} />
                  </span>
                ) : (
                  <span className="wl-badge" style={{ background: `hsl(${avatarHue(g.title)} 48% 40%)` }}>
                    {initial(g.title)}
                  </span>
                )}
                <div className="wl-gmeta">
                  <div className="wl-gname">{g.title}</div>
                  <div className="wl-gapp">{g.kind === "call" ? "Calls" : appName(g.app)}</div>
                </div>
                <span className="wl-gcount">{pluralize(g.count, "match", "matches")}</span>
              </div>

              <div className="wl-items">
                {g.matches.map((m, i) => {
                  const prev = g.matches[i - 1];
                  const showDay =
                    !prev || new Date(prev.capturedAt).toDateString() !== new Date(m.capturedAt).toDateString();
                  return (
                    <Fragment key={m.id}>
                      {showDay && <div className="wl-day">{dayLabel(m.capturedAt)}</div>}
                      {m.kind === "call" ? (
                        <div className="wl-call">
                          <span className="wl-call-main">
                            {highlight(m.name ?? m.number ?? "Unknown", selected)}
                            {m.number && m.name ? <span className="wl-call-num"> · {highlight(m.number, selected)}</span> : null}
                          </span>
                          <span className={`call-dir call-${m.direction ?? "in"}`}>{m.direction ?? "call"}</span>
                          <span className="wl-time">{shortTime(m.capturedAt)}</span>
                        </div>
                      ) : (
                        <div className={`wl-msg-row ${m.direction === "out" ? "out" : "in"}`}>
                          <div className={`wl-bubble ${m.direction === "out" ? "out" : "in"}`}>
                            <span className="wl-text">{highlight(m.text, selected)}</span>
                            <span className="wl-time">{shortTime(m.capturedAt)}</span>
                          </div>
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
