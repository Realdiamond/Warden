# Putting Warden on a server (pilot)

This runs the API, the moderator console, the database and HTTPS on one Linux server. It is the
right size for a closed pilot; the full platform moves to managed Kubernetes later (see the
Technical tab of the requirements).

## What you need

- A Linux server (Ubuntu 24.04, 2 CPUs, 4 GB RAM, 40 GB disk is enough for a pilot).
- A domain name, with an `A` record such as `api.yourdomain.ng` pointing at the server's IP address.

## Steps

1. Install Docker on the server: <https://docs.docker.com/engine/install/ubuntu/>.
2. Copy this repository onto the server and go into the `deploy` folder.
3. Create the settings file and fill it in:
   ```bash
   cp .env.example .env
   openssl rand -hex 24      # POSTGRES_PASSWORD (hex, so it is safe inside the database address)
   openssl rand -base64 32   # WARDEN_FIELD_KEY
   openssl rand -base64 32   # WARDEN_HMAC_KEY
   openssl rand -base64 32   # WARDEN_SIGNING_KEY (signs responder broadcasts)
   openssl rand -hex 24      # USSD_CALLBACK_SECRET (only if you set up USSD)
   ```
   Put the values and your `DOMAIN` into `.env`. Once the server is running (step 4), print the
   public key that matches your signing key for the app build:
   `docker compose exec api node apps/api/src/cli/gen-keys.ts --public`
4. Start everything: `docker compose up -d --build`
5. Create the first moderator account (the password is printed once; store it safely):
   ```bash
   docker compose exec api node apps/api/src/cli/create-staff.ts --email you@example.com --role admin
   ```
6. Open `https://api.yourdomain.ng` for the moderator console.
7. On the phone app, open Settings, turn off demo mode, and enter `https://api.yourdomain.ng`.

## Optional pieces

- **Text messages to trusted contacts** (SOS, late trips): open an SMS account with Termii, then
  set `SMS_DRIVER=termii` and `TERMII_API_KEY` in `.env` and restart. Until then the server only
  notes that a message would have been sent. The Termii connection has not been tried with a
  live account yet; send yourself a test SOS first.
- **Responder organisations**: after checking an organisation is genuine, create it and give
  its desk an account:
  ```bash
  docker compose exec api node apps/api/src/cli/create-org.ts --name "Lagos State Police Command" --kind police --area lagos
  docker compose exec api node apps/api/src/cli/create-staff.ts --email desk@example.ng --role responder --org <id printed above>
  ```
- **Broadcast checking in the app**: in GitHub, add the repository variable
  `WARDEN_BROADCAST_PUBLIC_KEY` (and `WARDEN_API_URL` to point new builds at your server). The
  next Android build marks broadcasts signed with your key as "Verified by Warden".
- **USSD**: with a USSD provider (for example Africa's Talking), set the callback address to
  `https://api.yourdomain.ng/v1/ussd/<USSD_CALLBACK_SECRET>`. The area list covers Lagos and the
  FCT; check the area centres in `apps/api/src/ussd/areas.ts` before launch.
- **Trusted reporters**: after checking a person (for example a CDA chair or a journalist), give
  them a code. Keep the printed id with your own records; Warden itself never links reports to
  the person.
  ```bash
  docker compose exec api node apps/api/src/cli/trusted-reporter.ts --add "Ikeja CDA chair"
  docker compose exec api node apps/api/src/cli/trusted-reporter.ts --revoke <id> --reason "Left the role"
  ```
  They type the code in the app under Settings, "Trusted reporter code".
- **Safe places**: export police stations, hospitals, clinics, pharmacies, fuel and fire stations
  for a city from OpenStreetMap as GeoJSON (for example with overpass-turbo.eu), then:
  ```bash
  docker compose cp lagos.geojson api:/tmp/lagos.geojson
  docker compose exec api node apps/api/src/cli/import-safe-stops.ts --file /tmp/lagos.geojson --source osm
  ```
  Run it again with `--verified` once you have spot checked the list.
- **News leads**: choose Nigerian news outlets that publish an RSS or Atom feed and allow it to be
  read, and list them in `.env` as `WARDEN_NEWS_FEEDS`. Then have the server read them every
  30 minutes with a cron job on the host (`crontab -e`, with your own path to the `deploy`
  folder):
  ```
  */30 * * * * cd /path/to/warden/deploy && docker compose exec -T api node apps/api/src/cli/fetch-news.ts >> /var/log/warden-news.log 2>&1
  ```
  Headlines that mention a place Warden covers appear on the console's News page. Nothing goes
  on the map until a moderator reads the story and adds it. Only headlines and summaries from
  the feeds are kept; Warden never copies whole articles or scrapes web pages.
- **Fleet customers** (M9): once a transport or logistics company has signed up, create it and
  give its operations desk an account. They sign in at the same console address:
  ```bash
  docker compose exec api node apps/api/src/cli/create-org.ts --name "Example Haulage Ltd" --kind fleet
  docker compose exec api node apps/api/src/cli/create-staff.ts --email ops@example.ng --role fleet --org <id printed above>
  ```
- **Risk-data API customers** (M9): give each customer a key and send them
  [the API guide](data-api.md). The key is printed once; send it securely. At the end of the
  month print their usage for the invoice:
  ```bash
  docker compose exec api node apps/api/src/cli/api-client.ts --add "Example Insurance" --quota 5000
  docker compose exec api node apps/api/src/cli/api-client.ts --usage <id> --month 2026-10
  docker compose exec api node apps/api/src/cli/api-client.ts --revoke <id> --reason "Contract ended"
  ```
- **Support services** for private reports: send Claude the organisations and numbers you have
  confirmed; they go in `packages/shared/src/support.ts` and ship with the next app build.

## Backups

Warden makes one encrypted copy of the whole database every night. Without backups, a broken
disk or a mistake loses every report, account and audit entry.

1. Make a backup passphrase and put it in `.env` as `BACKUP_PASSPHRASE`:
   ```bash
   openssl rand -base64 32
   ```
   **Also save it in your password manager**, away from the server. Every backup is locked with
   it; without it no backup can be opened, by you or anyone else.
2. Run one backup by hand to check it works:
   ```bash
   sudo ./backup.sh
   ```
   It prints where the file went (normally `/var/backups/warden/warden-<date>-<time>.dump.enc`)
   and its size. It checks each new backup can be read back before keeping it.
3. Run it every night at 02:15 with a cron job on the host (`sudo crontab -e`, with your own path
   to the `deploy` folder):
   ```
   15 2 * * * /path/to/warden/deploy/backup.sh >> /var/log/warden-backup.log 2>&1
   ```
   The server keeps the newest 14 backups (`BACKUP_KEEP` in `.env`) and deletes older ones.
   `tail /var/log/warden-backup.log` shows how the last runs went.

**A copy away from the server (strongly recommended).** If the server itself is lost, backups on
it go with it. `backup.sh` can also send each backup to online storage with
[rclone](https://rclone.org). Any of these work; pick one:

- **Backblaze B2**: cheap storage, rclone type `b2`.
- **Cloudflare R2**: no charge for downloading backups again, rclone type `s3` with provider
  `Cloudflare`.
- **Any other S3-compatible storage** (Amazon S3, Wasabi, DigitalOcean Spaces), rclone type `s3`.

Create a private bucket (for example `warden-backups`) and a key that can only use that bucket,
then on the server:

```bash
sudo apt install -y rclone
sudo rclone config          # make a "remote", for example named b2, with that key
```

Put `BACKUP_RCLONE_REMOTE=b2:warden-backups` (your remote name and bucket) in `.env` and run
`sudo ./backup.sh` once; `sudo rclone ls b2:warden-backups` should list the file. Copies there are
kept for 30 days (`BACKUP_REMOTE_KEEP_DAYS`). The files are encrypted before they leave the
server, so the storage company cannot read them.

## Restoring from a backup

`restore.sh` restores into a new, empty database first and only swaps it in when that worked; the
database it replaces is kept under another name, so a restore can be undone. The API stops for
about a minute during the swap.

1. See which backups exist:
   ```bash
   sudo ./restore.sh
   ```
2. Restore one, and type `RESTORE` when asked:
   ```bash
   sudo ./restore.sh /var/backups/warden/warden-20261104-021500.dump.enc
   ```
3. Check the console and the app. When all is well, delete the old copy it names at the end
   (`docker compose exec db dropdb -U warden warden_before_restore_...`).

**Onto a new server** (if the old one is gone): follow [Steps](#steps) on the new server, but
in `.env` use the **same** `WARDEN_FIELD_KEY`, `WARDEN_OLD_FIELD_KEYS`, `WARDEN_HMAC_KEY`,
`WARDEN_SIGNING_KEY` and `BACKUP_PASSPHRASE` as before, from your password manager. A new
`POSTGRES_PASSWORD` is fine. Start it with `docker compose up -d`, set up rclone as above, copy
the newest backup down and restore it:

```bash
sudo mkdir -p /var/backups/warden
sudo rclone copy b2:warden-backups/warden-20261104-021500.dump.enc /var/backups/warden/
sudo ./restore.sh /var/backups/warden/warden-20261104-021500.dump.enc
```

Practise this once before launch, and then every few months, on a spare server: a backup you
have never restored is a hope, not a backup.

## Knowing it is up

Warden has two health addresses:

- `https://api.yourdomain.ng/healthz` answers `{"ok":true}` while the server and database run.
- `https://api.yourdomain.ng/readyz` also checks that the background work is running: ending
  incidents, telling contacts about late trips and sending SOS texts. It answers with status
  200 when all is well and **503** when the database does not answer, the background work has
  not finished for over five minutes, or the hourly limit on texts to trusted contacts
  (`SMS_HOURLY_CAP`, 500 by default) has been reached. It shows only yes/no answers and timings,
  nothing about reports or people.
- If the alert says `"texts":{"ok":false}`, real SOS texts may be waiting. It usually means
  someone is starting fake trips or SOS ([security-review-2026-11.md](security-review-2026-11.md),
  item 1). Raise `SMS_HOURLY_CAP` in `.env` for now (`docker compose up -d`) and ask Claude to
  look at the sessions started in the last hour.

Use a free uptime service so you hear about problems before users do. For example
[UptimeRobot](https://uptimerobot.com) or [Better Stack](https://betterstack.com/uptime):

1. Create a free account.
2. Add an HTTP(S) monitor for `https://api.yourdomain.ng/readyz`, checking every 5 minutes (or as
   often as the free plan allows), that alerts when the status is not 200.
3. Add yourself (and a second person) as alert contacts by email, and install the service's phone
   app for push alerts.

On the server, `docker compose ps` shows each part and whether the API is `healthy`. Also keep an
eye on disk space: `df -h /` (stay below 80% full) and `du -sh /var/backups/warden`.

## Reading the logs

```bash
docker compose logs --tail=200 api     # the last 200 lines
docker compose logs -f api             # follow live; Ctrl+C to stop
docker compose logs --since 1h api     # the last hour
```

Lines to look for: `housekeeping failed` (background work broke), `sms delivery failed` (texts to
trusted contacts are not going out), and `unhandled error`. The logs never contain IP addresses,
phone numbers or report text, so you can send the last lines to Claude when asking for help.
If the API is stuck, `docker compose restart api` restarts it; `docker compose up -d` starts
anything that stopped.

## Changing keys

Change a key if it may have leaked, or on a schedule (yearly is plenty for a pilot). Run the
commands below on the server, in the `deploy` folder. They print new values; put them in `.env`,
never in chat or git.

**The data key** (`WARDEN_FIELD_KEY`, which locks exact locations, report text and trip details):

1. `docker compose exec api node apps/api/src/cli/gen-keys.ts --new-field-key k2` (use `k3`
   next time, and so on). Copy the three lines it prints into `.env`, then
   `docker compose up -d`. New data uses the new key; old data stays readable.
2. `docker compose exec api node apps/api/src/cli/rotate-field-key.ts` re-locks all the old data
   with the new key while the server keeps running. Run it again if it says rows were busy.
3. When it says everything is on the new key, empty `WARDEN_OLD_FIELD_KEYS` in `.env` and run
   `docker compose up -d`. Backups made before step 2 still need the old key, so keep it with
   those backups or delete them together.

**The broadcast key** (`WARDEN_SIGNING_KEY`). Phones only trust keys built into the app, so the
new key goes into an app build first:

1. `docker compose exec api node apps/api/src/cli/gen-keys.ts --new-signing-key s2`.
2. Set the printed `WARDEN_BROADCAST_PUBLIC_KEY` (it lists both keys) as the GitHub repository
   variable, and send the new app build to testers. Keep the two printed server lines safe.
3. Once most phones have that build, put the two server lines in `.env` and
   `docker compose up -d`. Broadcasts are now signed with the new key; phones on older builds
   drop them, which is why step 2 comes first.
4. In a later build, remove the old `s1:...` entry from the repository variable.

## Keep safe

- Keep these in a password manager, away from the server: `WARDEN_FIELD_KEY` (and any
  `WARDEN_OLD_FIELD_KEYS`), `WARDEN_HMAC_KEY`, `WARDEN_SIGNING_KEY` and `BACKUP_PASSPHRASE`.
  Backups hold exact locations and report text only in locked form: without `WARDEN_FIELD_KEY`
  they cannot be read, even by you, and without `BACKUP_PASSPHRASE` a backup cannot be opened.
- Make sure the nightly backup runs (see [Backups](#backups)) and that a copy leaves the server.
- Never put `.env` in git or send it in chat.
