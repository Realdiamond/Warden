# Milestones

This is the record of what has been built in Warden so far and what is still left before launch.
It is written to be read without knowing any code. The full plan lives in the
[Warden 2.0 Requirements Set](https://claude.ai/code/artifact/9e32d210-e4da-4bad-b899-a11b5ba06bcf);
the reasons behind each design choice are in the decision records in [`adr/`](adr/).

## Where things stand (15 October 2026)

All nine milestones are built and merged into `main`, and the checks pass. A test Android app
(APK) is published in the repository's GitHub Releases after every build.

What is left is mostly not code. Warden needs a server, accounts with outside providers, real
partner organisations, a native Pidgin speaker and a lawyer before it can launch. Those items are
gathered in [Before launch: what needs the founder](#before-launch-what-needs-the-founder) at the
end of this page.

| Milestone | What it gave Warden | Pull request | Merged |
| --- | --- | --- | --- |
| M1 | Report something and see it on the safety map | [#1](https://github.com/Realdiamond/warden/pull/1) (with M2 to M4) | 14 Oct 2026 |
| M2 | Alerts for the places you care about | [#1](https://github.com/Realdiamond/warden/pull/1) | 14 Oct 2026 |
| M3 | Trip sharing and SOS | [#1](https://github.com/Realdiamond/warden/pull/1) | 14 Oct 2026 |
| M4 | Police and responders, signed broadcasts, USSD | [#1](https://github.com/Realdiamond/warden/pull/1) | 14 Oct 2026 |
| M5 | Ready for a pilot: smaller app, safe key changes | [#2](https://github.com/Realdiamond/warden/pull/2) | 14 Oct 2026 |
| M6 | Safer trips, trusted reporters, safe places, Pidgin | [#3](https://github.com/Realdiamond/warden/pull/3) | 14 Oct 2026 |
| M7 | Community feed and route safety score | [#4](https://github.com/Realdiamond/warden/pull/4) | 14 Oct 2026 |
| M8 | Voice notes, photos, SOS sound, spoken broadcasts, news | [#5](https://github.com/Realdiamond/warden/pull/5) | 14 Oct 2026 |
| M9 | Fleet dashboard and paid risk-data API | [#6](https://github.com/Realdiamond/warden/pull/6) | 14 Oct 2026 |

In the lists below, a ticked box is done and an empty box is still open.

## M1: Report to map

Anyone can report an incident from the Android app without an account. A moderator checks it in
the web console, and once it passes the publication rules it appears on the public map. The map
only ever shows a rough area, never the exact spot, and private reports (sexual or domestic
violence, missing persons) never go on the map at all.

- [x] Project set-up, tooling and the first decision records
- [x] Shared rules: incident categories, what a report contains, when it may be published, how
      big the public area is
- [x] Server: anonymous reports, merging of reports about the same incident, the map
- [x] Server: staff sign-in, moderator actions, a tamper-evident log of every moderator action,
      and expiry of old incidents
- [x] Moderator console: queue, incident detail, verify, hold, remove, resolve
- [x] Android app: map, incident card, quick report, reports saved while offline and sent later,
      "my reports", demo mode
- [x] Automatic tests on every change, and a test APK published after each build
- [x] Smaller test APK (done in M5)
- [ ] First tests on real low-end Android phones on MTN, Airtel and Glo

## M2: Alerts ([ADR 0002](adr/0002-alerts-without-push.md))

People save up to five places (home, work, school and so on) and get alerts when something
happens near them. The places stay on the phone; the server never learns where people live.

- [x] Saved places kept on the phone (up to five, plus "where I last was")
- [x] The phone downloads alerts for a wide area and picks out the ones near its own places
- [x] Alert levels (danger, warning, advisory), quiet hours, protection against floods of
      alerts, and a test alert
- [x] "It's over" and corrections, sent only to people who got the first alert
- [x] Alerts read aloud in English while the app is open (Pidgin added in M6)
- [x] Reactions: "Still happening", "It's over", "Looks false", never used on critical incidents
- [x] Background checks about every 15 minutes when the phone allows it
- [ ] Faster push alerts, once a Firebase project exists (founder)

## M3: Trips and SOS ([ADR 0003](adr/0003-trips-and-sos.md))

People can share a trip with up to five trusted contacts, who get a private live-location link
and a text if the person is late. SOS sends an alarm to the contacts after a five-second
countdown.

- [x] Trusted contacts (up to five) kept on the phone; "Tell them" sends an invitation text from
      the person's own phone
- [x] Trip sharing: private live-location link, arrival time, text to contacts when overdue,
      "add time"
- [x] SOS with a five-second countdown, texts to contacts, live location and a 112 button
- [x] Safety PIN, and a duress PIN that looks like a normal stop but quietly raises the alarm
- [x] A live page for contacts; the secret part of the link never reaches the server's logs
- [x] Stops and alarms are kept on the phone and sent when signal returns
- [x] Off-route checks (added in M6)
- [ ] Texts actually sent: needs the SMS provider account (founder)

## M4: Responders and channels ([ADR 0004](adr/0004-responders-and-ussd.md))

Verified organisations such as the police, emergency services and community groups get their own
console. They see incidents in their area, post public updates, show where their teams are, and
send broadcasts that the app can prove came from them. People without smartphones can report by
USSD.

- [x] Verified organisations with an area they cover, and accounts for their staff
- [x] Responder console: incidents in their area (every look is logged), public updates on the
      map, team deployments with four levels of visibility, signed broadcasts, SOS board
- [x] App: responder updates on incident cards, deployments on the map, a check that broadcasts
      are genuine, and an "also alert responders" option on SOS
- [x] USSD reporting for Lagos and the FCT (held for a moderator; rough area only)
- [ ] SMS reporting (needs the SMS provider's inbound number)
- [ ] Real organisations signed up, with their official boundaries (founder)

## M5: Ready for the pilot ([ADR 0005](adr/0005-key-rotation.md), [PR #2](https://github.com/Realdiamond/warden/pull/2))

Preparation for a closed pilot: a smaller download, and a safe way to change the secret keys
that protect report data and broadcasts.

- [x] Smaller test app: one APK per type of phone processor
- [x] The key that encrypts report details can be changed; old data stays readable and can be
      re-encrypted with the new key
- [x] The key that signs broadcasts can be changed; phones trust several keys at once
- [x] Off-route checks (built in M6; limits still need tuning on real roads)
- [x] Pidgin (draft built in M6; other languages need translators)

## M6: Safer trips and languages ([ADR 0006](adr/0006-safer-trips-and-languages.md), [PR #3](https://github.com/Realdiamond/warden/pull/3))

Trips watch for the phone going off its route. Trusted community members can report with more
weight. The trip screen shows safe places nearby. The app has a first draft in Pidgin.

- [x] Off-route check: the phone asks "Are you OK?" and contacts are told only if there is no
      answer (PIN to answer; the duress PIN raises the alarm quietly)
- [x] Trusted reporters: anonymous codes, their reports show sooner, codes can be withdrawn, and
      every change is logged
- [x] Safe places nearby (police, hospitals, clinics, fuel, fire stations) on the trip screen,
      loaded from OpenStreetMap or from partner lists
- [x] Pidgin draft for alerts, spoken alerts, SOS, trips, safe places and private-report help
- [x] Help after a private report: 112 and confirmed support services only
- [ ] Pidgin checked by a native speaker (founder)
- [ ] Real support services and their phone numbers confirmed with each organisation (founder)
- [ ] Safe places loaded for Lagos and Abuja on the live server, and spot-checked
- [ ] Off-route limits tuned after real trips in Lagos traffic

## M7: Community feed and route score ([ADR 0007](adr/0007-community-feed-and-route-score.md), [PR #4](https://github.com/Realdiamond/warden/pull/4))

A feed for each area with checked tips from the public, notices from the Warden team and live
broadcasts. The trip screen gives a simple safety score for the chosen route.

- [x] Community feed in the app: checked tips, Warden team notices and live broadcasts for the
      area, with "Report this" on tips and notices
- [x] Anonymous tips, read by a moderator before anyone sees them (area only)
- [x] Three reports from users hide a post until a moderator looks again
- [x] Route safety score on the trip screen, worked out on the phone
- [ ] A moderator rota for reading tips before launch (founder)

## M8: Media, voice and insights ([ADR 0008](adr/0008-media-voice-and-insights.md), [PR #5](https://github.com/Realdiamond/warden/pull/5))

Reports can carry voice notes, photos and short videos. SOS can record sound. Responders can send
spoken broadcasts. Each area gets an "outlook" based on recent incidents, and moderators see
news headlines that may be worth adding to the map.

- [x] Voice notes, photos and short videos with reports: seen only by staff, encrypted, deleted
      after 30 days, and the location hidden inside photos removed
- [x] Every time staff open a file, it is logged
- [x] Sound recorded during an SOS (the person turns this on in Safety settings), which their
      contacts can play from their link
- [x] Spoken broadcasts recorded in the console, signed, and checked on the phone before playing
- [x] Area outlook in the app: counts from the last three months, not a prediction
- [x] News page in the console: headlines from chosen news feeds, added to the map only by a
      moderator
- [ ] News outlets chosen and their feed terms checked (founder)
- [ ] SOS sound tried on a few Android phones with the screen off (founder)
- [ ] A lawyer's view on SOS sound recording and on keeping report media for 30 days (founder)

## M9: Fleet dashboard and risk-data API ([ADR 0009](adr/0009-fleet-and-data-api.md), [PR #6](https://github.com/Realdiamond/warden/pull/6))

Two paid products. Transport and logistics companies get a dashboard for the places and routes
they care about. Businesses can buy access to area-level risk data through an API. Both only use
what is already public on the map.

- [x] Fleet accounts in the console: watched places, public incidents around each in the last 24
      hours, the area outlook and a route check; no access to moderation or responder screens
- [x] Risk-data API with keys, daily limits, daily usage records for invoicing, and area counts
      that hide very small numbers ([API guide](data-api.md))
- [ ] Prices, contracts and terms of use for fleets and data customers (founder, with a lawyer)
- [ ] First fleet and data customers signed up (founder)

## Before launch: what needs the founder

None of these need more code. [deploy.md](deploy.md) explains how to switch each one on once it
exists.

**To run Warden for real**

- [ ] A server and a domain name for the live system
- [ ] Google Play developer account, to publish the app
- [ ] Company registration (CAC)

**Outside providers**

- [ ] SMS provider account and sender ID, so SOS and late-trip texts are actually sent
      (Termii is already supported)
- [ ] USSD short code (Africa's Talking or similar)
- [ ] Firebase project, for faster push alerts (the app works without it)

**Partners and people**

- [ ] Agreements with responder organisations (police, emergency services, community groups)
- [ ] Support organisations for private reports, with confirmed phone numbers
- [ ] A native speaker to check the Pidgin text
- [ ] A moderator rota, including for community tips
- [ ] First fleet and risk-data customers

**Content to load on the live server**

- [ ] Safe places for each launch city (Lagos and Abuja first), spot-checked
- [ ] News feeds that moderators should see, with their terms checked

**Legal**

- [ ] Privacy notice, consent text and data protection impact assessment (DPIA) with a lawyer
- [ ] A lawyer's view on SOS sound recording and keeping report media for 30 days
- [ ] Prices, contracts and terms for paid customers

**Testing in the field**

- [ ] The app on real low-end Android phones on MTN, Airtel and Glo
- [ ] Off-route limits tuned on real trips in Lagos traffic
- [ ] SOS sound tried with the screen off on a few phones
