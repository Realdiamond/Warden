# 0008 — Media, voice and area insights

Status: accepted (M8)

## Context

The v1 documents ask for voice and video reports, spoken alerts and officer voice broadcasts,
"stealth" recording during an SOS, AI risk prediction for areas, and scraping news sites for
incidents. Taken literally, several of these clash with Warden's rules: media can identify
reporters and bystanders, hidden recording is unlawful in many situations and can put the
person at more risk, an opaque "AI risk score" can stigmatise neighbourhoods, and scraping
news sites breaks their terms and copies copyrighted work.

## Decision

- **Report files are never public.** A report can carry up to 3 files: a voice note (up to 60
  seconds), a JPEG photo or a short MP4 video (about 20 seconds). The phone sends them after the
  report, proving ownership with the report's status token, and keeps them on the phone (in
  the app's private folder) until they are sent. The server checks each file's first bytes
  against its type, removes the hidden details from photos (EXIF with GPS position and camera
  serial number, XMP, IPTC, comments), encrypts the bytes like report text, includes them in key
  rotation, and deletes them after 30 days. Videos keep their metadata, which can include a
  position; only staff and responders can open them.
- **Opening a file is audited.** Moderators (and responders, for incidents in their area) open
  files one at a time from the incident page. Each opening writes `report_media.read` to the
  audit log, and the request needs the console header, so a link on another site cannot make
  a signed-in browser open files.
- **SOS sound is opt-in and visible.** "Record sound during SOS" is off until the person turns it
  on in Safety settings, which asks for the microphone. During an SOS the phone records 30-second
  clips and sends them for the person's contacts, who can play them on their private link. Android
  shows its own "recording" notification, so this is not hidden from the phone's owner; nothing
  on Warden's screen draws attention to it. Trips never record. Clips are deleted after 30 days.
- **Spoken broadcasts are signed.** Responders can record a spoken version of a broadcast in the
  console. Its SHA-256 is part of the signed text (`warden-broadcast-v2`), so the phone plays it
  only if the bytes match what Warden signed. Text broadcasts keep the v1 signing text, so older
  apps still verify them. The written message stays the official one.
- **Area outlook instead of AI prediction.** The outlook counts public incidents in the last 90
  days in areas a few kilometres across (H3 resolution 7), weighted by severity, with the trend
  and the busiest day and time of day. Areas with fewer than 5 incidents get no outlook at all.
  It is worked out from the same data as the public map, can be explained in one sentence, and
  never scores people or predicts individual crimes. Private categories are never counted.
- **News feeds, not scraping.** The server reads RSS and Atom feeds that the operator lists in
  `WARDEN_NEWS_FEEDS`, keeps only the headline, summary and link, and suggests a category and a
  covered place. Leads wait on the console's News page; a moderator reads the story and either
  dismisses it or adds it as an unconfirmed incident for the whole area, with an audit entry.
  Nothing from the news reaches the map on its own.

## Consequences

- Media uses storage and data; size limits keep a report's files under about 12 MB and an hour
  of SOS sound under about 15 MB.
- The outlook is only as good as the reports behind it, and under-reported areas look calm. The
  app says what it is based on.
- News leads need moderator time, and the place matching only knows the places in
  `apps/api/src/services/news.ts`.
