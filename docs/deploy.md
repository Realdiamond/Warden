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

## Keep safe

- Back up the database every day and keep `WARDEN_FIELD_KEY` somewhere safe. Without that key,
  encrypted locations and report text cannot be read, even from a backup.
- Never put `.env` in git or send it in chat.
