# 0009 — Fleet dashboard and risk-data API

Status: accepted (M9)

## Context

The v1 documents plan two paid products: a dashboard for fleets (logistics, transport and
ride-hailing companies) that tracks drivers and warns them about danger, and an API that sells
Warden's risk data to businesses such as insurers. Selling data raises the biggest privacy risk
in the whole product: a buyer could try to work out who reported what, where people live, or
which streets to avoid, and tracking drivers is surveillance unless the driver chooses it.

## Decision

- **Paid products get the public map, never more.** Both products use only incidents that have
  passed the publication rules, in their public H3 areas, without report text, reporters, media,
  exact points or private categories (sexual and domestic violence, missing persons). A paying
  customer learns nothing that a person using the app could not see.
- **Fleets watch places, not people.** A fleet company is an organisation of kind `fleet` with
  its own console accounts (role `fleet`). It saves up to 50 places (a point and a radius, such as
  a depot or a busy stop) and sees the public incidents of the last 24 hours around each place,
  the 3-month area outlook, and a route check that uses the app's route score on the last 7 days.
  Fleet accounts cannot open any moderation or responder screen, and responders cannot open the
  fleet screens. Adding and removing places is written to the audit log. Live driver tracking is
  left out: drivers who want their company to know they are safe can share a trip with a
  dispatcher as a trusted contact, which they start and stop themselves.
- **The data API sells counts per area.** `GET /v1/data/areas` gives, for each H3 resolution-7
  area (a few kilometres across), the number of public incidents in the last 7, 30 or 90 days by
  severity and by category group. Areas with fewer than 3 incidents are left out, so a single
  report can never be singled out. `GET /v1/data/outlook` gives the same outlook the app shows.
- **Keys, quotas and invoices.** Each customer gets a key (`wdn_` plus 256 random bits) from the
  `api-client` command. Only a keyed hash is stored, keys never appear in logs, and creating or
  revoking a key is written to the audit log. Each request counts towards a daily quota (reset at
  midnight Nigeria time) and is stored per customer per day, which is what invoices are based on.
  Requests are also limited to 60 a minute. Payment itself happens outside Warden.

## Consequences

- Fleets and data customers need onboarding by hand (contract, then `create-org --kind fleet`
  or `api-client --add`). There is no self-service sign-up yet.
- Area counts only show what is reported. Places where people report less look calmer, and the
  API documentation says so.
- The terms of use for data customers must forbid trying to identify people and reselling data;
  that is a contract matter for the founder and a lawyer.
