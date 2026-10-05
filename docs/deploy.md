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
   ```
   Put the three values and your `DOMAIN` into `.env`.
4. Start everything: `docker compose up -d --build`
5. Create the first moderator account (the password is printed once; store it safely):
   ```bash
   docker compose exec api node apps/api/src/cli/create-staff.ts --email you@example.com --role admin
   ```
6. Open `https://api.yourdomain.ng` for the moderator console.
7. On the phone app, open Settings, turn off demo mode, and enter `https://api.yourdomain.ng`.

## Keep safe

- Back up the database every day and keep `WARDEN_FIELD_KEY` somewhere safe. Without that key,
  encrypted locations and report text cannot be read, even from a backup.
- Never put `.env` in git or send it in chat.
