# @warden/console

Moderator console (React + Vite). Staff sign in, review held reports, verify, hold, remove or
resolve incidents, and see the audit trail. Exact locations are shown here only.

## Run locally

Start the API first (`apps/api`), then:

```bash
pnpm dev        # http://localhost:5173, proxies /v1 to the API on :8080
```

For a single deployable, build the console and let the API serve it:

```bash
pnpm build
# in apps/api/.env: CONSOLE_DIST=../console/dist
```

Set `VITE_MAP_STYLE_URL` to change the map style (default: OpenFreeMap "liberty"). The API's
`MAP_ORIGINS` must include the style's host so the Content Security Policy allows it.
