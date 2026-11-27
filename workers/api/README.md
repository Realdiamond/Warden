# Andsv API — Cloudflare Worker + D1

The API as a Cloudflare Worker backed by D1 (Cloudflare's SQLite). Same behaviour and endpoints
as the Node version in `services/api`, ported to Web Crypto and D1 so it runs on Cloudflare's free
tier. This is the deploy target; the Node version stays for local dev and tests.

## Deploy (one-time setup)

With a Cloudflare API token available to Wrangler (Workers, D1, Pages: Edit; Account Settings: Read):

```bash
pnpm install

# 1. Create the database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create monitor

# 2. Create the tables
npx wrangler d1 execute monitor --remote --file=./schema.sql

# 3. Set the two secrets (never commit these)
npx wrangler secret put ANDSV_JWT_SECRET            # any long random string
npx wrangler secret put ANDSV_ENCRYPTION_KEY        # 64 hex chars (32 bytes)
#   generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. Deploy
npx wrangler deploy
#   → https://andsv-api.<your-subdomain>.workers.dev
```

Point the apps and dashboard at that URL.

## Local development

```bash
# .dev.vars holds local secrets (gitignored)
npx wrangler d1 execute monitor --local --file=./schema.sql
npx wrangler dev                    # http://localhost:8787
```

Verified locally with Miniflare + local D1: full flow (signup → pair with consent → encrypted
event → read back decrypted) plus the consent gate and token checks.
