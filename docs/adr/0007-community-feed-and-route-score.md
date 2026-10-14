# 0007 — Community feed and route safety score

Status: accepted (M7)

## Context

The v1 documents describe a social-style community feed (posts, replies, profiles) and a
server-side route risk score. Both clash with Warden's privacy rules: an open feed can name,
shame or locate people, and a server-side route score would mean sending where people start and
where they are going.

## Decision

- **Tips, not posts.** Anyone can send a short tip (10 to 280 characters). There are no names,
  profiles or replies. The phone sends the middle of the map it is showing; the server keeps
  only the H3 resolution-7 cell (a few kilometres across) and its centre. Tip text is encrypted
  at rest like report text, and is part of key rotation.
- **A person reads every tip first.** Tips wait in the console's Community page. Moderators see
  warnings for phone numbers, emails, links, social media handles and addresses, and need a
  reason to reject or remove, which goes in the audit log. Tips leave the feed after 72 hours.
- **Flags, not votes.** Anyone can report a post. Three reports from different phones hide it
  and send it back to the moderators. Each phone is counted by a keyed hash per post, as for
  incident reactions.
- **Notices and broadcasts.** Moderators can post a "Warden team" notice for an area, which is
  shown at once. Live responder broadcasts in the area are shown in the same feed. Responders
  keep using signed broadcasts; they cannot moderate tips.
- **Route score on the phone.** The trip screen loads the public map (last 7 days) for the box
  around the person and their destination, and scores incidents within 1 km of the straight
  line by severity, age and confirmation (`packages/shared/src/routeScore.ts`). The server sees
  only a map request, like any other. It says "Route looks calm", "Take care on this route" or
  "Think about another route or time", and lists the main incidents. Journeys too long for one
  map request get no score.

## Consequences

- Tips need moderator time. Sending is limited to 3 tips an hour per phone.
- The score follows a straight line, not the roads. It is a rough guide, and the app says what
  it is based on.
