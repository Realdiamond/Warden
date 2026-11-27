import { Link } from "react-router-dom";
import { Smartphone, ListChecks, MessageSquare, ScreenShare, EyeOff, ShieldCheck } from "lucide-react";

// Set this to your support address to show a contact line (leave empty to hide it).
const SUPPORT_EMAIL = "";

export function Help() {
  return (
    <div className="help">
      <div className="page-header">
        <h1>Help</h1>
        <p>How to set up a phone, turn on what you want to see, and fix the common snags.</p>
      </div>

      <section className="panel">
        <div className="panel-head">
          <Smartphone size={18} />
          <h2>Add a phone</h2>
        </div>
        <ol className="help-steps">
          <li>On the dashboard, open Devices and tap Add device, then name the phone.</li>
          <li>Install the Andsvapp on that phone and open it.</li>
          <li>Type the pairing code from the dashboard into the app. The person using the phone taps to agree — a notice then stays in their status bar the whole time.</li>
        </ol>
      </section>

      <section className="panel">
        <div className="panel-head">
          <ListChecks size={18} />
          <h2>Turn on what you want to see</h2>
        </div>
        <p className="muted">
          Each thing is switched on from the phone's own settings, not from here. Open a device and
          check its <strong>Setup</strong> tab — it shows exactly what's on, what's off, and the steps
          for each.
        </p>
        <ul className="help-list">
          <li><strong>Location</strong> — where the phone is, on the map.</li>
          <li><strong>App usage</strong> — screen time and app limits.</li>
          <li><strong>Notifications access</strong> — message alerts as they arrive.</li>
          <li><strong>Accessibility</strong> — reads chats in WhatsApp, Snapchat, TikTok and similar apps.</li>
          <li><strong>Device admin</strong> — lets you lock the phone from here.</li>
        </ul>
      </section>

      <section className="panel">
        <div className="panel-head">
          <MessageSquare size={18} />
          <h2>Chats aren't showing</h2>
        </div>
        <p className="muted">
          The two-sided chat view comes from the phone's screen reader. On the phone: Settings →
          Accessibility → Andsv→ turn On. If it's greyed out (common on Samsung): Settings → Apps →
          Andsv→ ⋮ → Allow restricted settings, then turn it on. Message <em>notifications</em> show
          under Alerts and don't need this.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <ScreenShare size={18} />
          <h2>Screen share closes the app</h2>
        </div>
        <p className="muted">
          Make sure the phone is on the latest Andsvapp. If it still closes, reopen Andsvon the
          phone and tap "View last error log", then send that text to whoever set this up.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <EyeOff size={18} />
          <h2>Hiding and reopening the app on the phone</h2>
        </div>
        <p className="muted">
          In the Andsvapp you can hide its icon from the phone's app list (the monitoring notice
          still stays visible). To reopen it afterwards: tap the ongoing "Monitoring is on"
          notification, or go to Settings → Apps → Andsv→ Open.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <ShieldCheck size={18} />
          <h2>What's monitored, and consent</h2>
        </div>
        <p className="muted">
          Andsvis open, not hidden: the person using the phone agrees before pairing, and a notice
          stays in their status bar whenever monitoring is running. It is for phones you are
          responsible for, with the agreement of the person using them.
        </p>
        {SUPPORT_EMAIL ? (
          <p style={{ marginTop: "0.6rem" }}>
            Still stuck? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        ) : (
          <p className="muted" style={{ marginTop: "0.6rem" }}>
            Still stuck? Contact the person who set up this dashboard.
          </p>
        )}
      </section>

      <Link to="/devices" className="back-link" style={{ marginTop: "0.5rem" }}>
        Back to devices
      </Link>
    </div>
  );
}
