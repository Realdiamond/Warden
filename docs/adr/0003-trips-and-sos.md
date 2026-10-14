# 0003 — Trips and SOS through private links and server-sent texts

Status: accepted (M3)

## Context

Phase 1 trip sharing and SOS go to trusted contacts only (no responders yet). Contacts may not
have the app. The person in danger may lose signal, run out of battery, or be forced to stop
sharing. Android restricts background location and silent SMS sending.

## Decision

- A **session** (trip or SOS) is created by the phone. The server returns two random tokens and
  stores only their SHA-256 hashes: a control token kept by the phone, and a view token that goes
  in the contacts' link `https://<domain>/live#<id>.<token>`. Browsers never send the part after
  `#`, so the token stays out of every server and proxy log; the page sends it in a header.
- Exact locations go only to holders of the view token, whom the person chose. They are
  encrypted at rest with names, notes and numbers, and all of it is deleted two days after the
  session ends. No public endpoint ever returns them.
- The phone shares location through a visible Android **foreground service**, which needs only
  "while using the app" permission. Points are queued on the phone when there is no signal.
- The **server sends texts**, so contacts are told even if the phone dies: at once for SOS; when
  a trip is 10 minutes overdue; on a duress stop; and when an alarm ends. Texts go through an
  encrypted outbox with retries, at most 10 per number a day, and an hourly cap. The person can
  also text the link from their own phone (SMS composer), which works without the provider.
- A **duress PIN** ends the session on screen exactly like the real PIN, with the same server
  reply, while the server keeps the session open and sends an urgent text.

## Consequences

- Until the SMS provider account exists, the server only logs that a text would have been sent;
  the person's own phone is the only way contacts hear about it.
- Contact numbers reach the server only while a session runs; Warden keeps no address book.
- Route-deviation alerts are not built yet: GPS noise on low-end phones needs field testing.
