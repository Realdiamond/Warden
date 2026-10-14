# Warden risk-data API

For customers with a Warden data contract. All answers are built from Warden's public safety map:
counts of incidents per area, never exact locations, reports or anything about the people who
reported. Areas with fewer than 3 incidents in the period are left out.

## Access

Every request needs your key in the `Authorization` header:

```
Authorization: Bearer wdn_...
```

Keep the key secret. Warden can revoke it and issue a new one at any time. Each request counts
towards your daily quota, which resets at midnight Nigeria time (UTC+1). There is also a limit of
60 requests a minute. Over either limit you get `429 Too Many Requests`.

`bbox` is `minLng,minLat,maxLng,maxLat` in degrees and covers at most 6 degrees each way.

## `GET /v1/data/areas?bbox=…&days=7|30|90`

Public incidents per area (H3 resolution 7, a few kilometres across) in the last 7, 30 or 90 days
(30 if not given).

```json
{
  "areas": [
    {
      "cell": "87589c984ffffff",
      "center": { "lat": 6.52, "lng": 3.38 },
      "boundary": [[3.37, 6.53], "…"],
      "incidents": 12,
      "bySeverity": { "critical": 2, "high": 6, "standard": 4 },
      "byGroup": { "violent_crime": 5, "property_crime": 4, "road": 3 }
    }
  ],
  "days": 30,
  "minIncidents": 3,
  "generatedAt": "2026-10-14T12:00:00.000Z"
}
```

## `GET /v1/data/outlook?bbox=…`

The 3-month area outlook shown in the Warden app: level (`low`, `moderate`, `elevated`), trend
(`rising`, `steady`, `falling`), number of incidents, and the busiest day and time of day when
one stands out. Areas with fewer than 5 incidents are left out.

## `GET /v1/data/usage`

Your requests per day for the last month and your daily quota. Does not count towards the quota.

## What the numbers mean

- Only incidents that passed Warden's checks and appeared on the public map are counted.
  Disputed and removed incidents are not.
- Sexual and domestic violence and missing persons are never included.
- Counts reflect what people reported. Areas where fewer people use Warden can look calmer
  than they are.
- You may not use the data to try to identify any person, or resell it, under your contract.
