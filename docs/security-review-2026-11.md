# Security review before the pilot (November 2026)

An independent review of the server, the deploy files, the console and the app, done before
real people use Warden. Each finding was checked against the code; the fixed ones have tests.

## Fixed

| Finding | What could happen | Fix |
| --- | --- | --- |
| **Encoded addresses got past the staff screen check** (high) | A responder could open moderator pages by writing part of the address in `%`-code (`/v1/admin/%69ncidents/…`). That showed exact locations and words of any report, including private ones (sexual and domestic violence, missing persons), and allowed moderation actions. | The check now uses the route the server matched, not the address as typed. Tested with encoded addresses for every moderator and responder area. |
| **Anyone could lock all staff out of signing in** (low-medium) | One shared limit of 100 sign-in attempts a minute covered everyone, so flooding the sign-in page locked every moderator out. | Limits now count per sender and per email address, with a looser cap per email from anywhere so guessing spread across many senders still stops. Senders are a keyed hash held in memory only, never logged. |
| **Videos and voice notes kept their hidden details** (medium) | Phone videos can carry the GPS position where they were filmed and the phone model. Staff and responders who opened them could learn more about an anonymous reporter. | The server blanks those details before storing a file. The video still plays. Files whose structure does not add up are refused, except SOS sound clips, which are kept for contacts either way. |
| **Phone data copied to the cloud** (low) | Android's automatic backup would have copied trusted contacts, places, PIN details and trip tokens to the owner's Google account, though the app says they stay on the phone. | Backup is switched off for Warden. Contacts and places do not move to a new phone by themselves. |
| **Server packages with known problems** | `zod` (high: memory use with crafted input), `fastify`, `fast-uri`, `glob` and `minimatch` had published advisories. | Updated (see the pull request). The remaining advisories are in Expo's build tools (`node-forge`, `uuid`, `deepmerge`), which run only when building the app and never ship in it. |

## Needs a decision before launch

These are not bugs in the code but limits of an anonymous service. Each has a recommendation.

1. **Fake trips and SOS could send texts to anyone and use up the hourly text limit.**
   Starting a trip or SOS needs no account, and the caller chooses the numbers, so someone could
   send up to 10 texts a day to a stranger's number, or start enough sessions to reach the 500 an
   hour cap so that real SOS texts wait.
   *Recommendation:* for the closed pilot, keep the caps and watch the health page for the text
   limit being reached. Before the public launch, add Google Play Integrity checks so only the
   real Warden app can start a session, and keep spare text capacity for SOS.
2. **Fake "independent" reports, votes and flags.** Each phone identifies itself with a random
   number it makes itself, so one person with a script can pretend to be many: making a report
   look confirmed, marking a live incident over, or hiding a community post.
   Critical incidents always need a moderator already.
   *Recommendation:* the same Play Integrity check before the public launch, and until then let
   moderators review any incident marked over or disputed by votes.
3. **Two-step sign-in for staff.** Moderator and responder accounts can read exact locations;
   today they need only a password.
   *Recommendation:* add an authenticator-app code (TOTP) for staff before the public launch.
4. **Admin and moderator are the same in practice.** Both can moderate, post notices and open
   files. *Decide:* whether notices and news should be admin-only.
5. **How long reports are kept.** Reports (their exact place and words, encrypted) have no end
   date today. *Decide with the lawyer:* a period, after which the code removes the exact place
   and words and keeps only the area and type for statistics.
6. **The safety PIN on the phone.** It is stored as a salted hash; a 4-digit PIN can be guessed
   offline by someone who has already broken into the phone. *Recommendation:* move PINs and
   trip tokens to Android's secure storage in a later update.

## Checked and sound

All database queries are parameterised. The public map, alerts, deployments, fleet screens, the
data API and the outlook return only public areas and leave out private categories. Responders
see only their own area. Staff sessions use secure, same-site cookies with an extra header on
every change. Passwords use Argon2id. Trip and SOS links keep their secret out of server logs.
Exact locations, report words, files and phone numbers are encrypted with AES-256-GCM. The audit
log is hash-chained and covers every sensitive view. Logs leave out IP addresses and query
strings. Only Caddy is reachable from the internet, with automatic HTTPS and no access log.
