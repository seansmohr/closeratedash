# Mohr Sales KPI Dashboard

Per-agent close rate, held appointments, revenue per client (projected and confirmed), daily calls
and day-before confirmation calls. Pulls GoHighLevel and the Production Sheet every 15 minutes.
Only jmohrins.com Google accounts can sign in.

How the numbers are calculated: see [CLAUDE.md](CLAUDE.md).

## Run it locally

```bash
npm install
npm run dev        # http://localhost:3000 with made-up demo data, no sign-in
npm test
```

To run against real data locally, copy `.env.example` to `.env`, fill in `GHL_TOKEN` and
`GOOGLE_SERVICE_ACCOUNT_JSON`, and run `node --env-file=.env src/server.js` with `AUTH_MODE=dev`
and `NODE_ENV=development`.

## Launch on Railway

Plan on about 30 minutes. You need four things: a GoHighLevel token, a Google service account, a
Google sign-in client, and the Railway project.

### 1. GoHighLevel token

1. In the Mohr sub-account: **Settings → Private Integrations → Create new integration**.
2. Name it `Sales KPI dashboard` and give it only **View Contacts** (`contacts.readonly`) and
   **View Calendar Events** (`calendars/events.readonly`).
3. Copy the token. It's `GHL_TOKEN`. GoHighLevel recommends rotating these tokens every 90 days.

### 2. Google service account (reads the Production Sheet)

1. In [Google Cloud Console](https://console.cloud.google.com), create a project named `mohr-sales-kpi`.
2. **APIs & Services → Library**: enable **Google Sheets API**.
3. **IAM & Admin → Service accounts → Create**. No roles needed.
4. Open it: **Keys → Add key → JSON**. The downloaded file's contents are
   `GOOGLE_SERVICE_ACCOUNT_JSON`. Treat it like a password.
5. Share the **Master Production Live Feed** sheet with the service account's email
   (`…@….iam.gserviceaccount.com`) as **Viewer**. If Google blocks it, your Workspace admin
   settings restrict sharing outside jmohrins.com; allow it for this address.

If the dashboard ever shows the sheet as empty, the IMPORTRANGE mirror hasn't loaded. You can skip
the mirror: share the master workbook with the service account instead and set
`SHEET_ID=1YVvXDVkLQmjQ8zgWlC_Ax-qiP9u8uh2wQfALA53KhOc` and `SHEET_RANGE='Production Sheet'!A:U`.

### 3. Google sign-in client

In the same Cloud project:

1. **APIs & Services → OAuth consent screen**: user type **Internal**, so only jmohrins.com
   accounts can use it. App name `Mohr Sales KPIs`.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. Leave the redirect URI for step 4; you need the Railway address first.
4. Copy the client ID and secret: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

### 4. Railway

1. **New Project → Deploy from GitHub repo →** `seansmohr/closeratedash`.
2. In the project: **New → Database → PostgreSQL**.
3. Open the app service: **Settings → Networking → Generate Domain**. That address is `PUBLIC_URL`
   (for example `https://closeratedash-production.up.railway.app`).
4. Back in Google Cloud, add the authorized redirect URI `PUBLIC_URL/auth/callback`
   (for example `https://closeratedash-production.up.railway.app/auth/callback`).
5. App service **Variables**:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `GHL_TOKEN` | from step 1 |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | from step 2 |
   | `DASHBOARD_PASSWORD` | optional: a shared password instead of Google sign-in. With it set, skip step 3 and the three rows below |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from step 3 |
   | `PUBLIC_URL` | from step 4.3, no trailing slash |
   | `SESSION_SECRET` | run `openssl rand -hex 32` and paste the result |

6. Railway redeploys. In the deploy logs you should see
   `[refresh] N applications, N appointment records`. If a variable is missing, the log lists
   which one and the app stops.
7. Open the address, sign in with your jmohrins.com account, and the dashboard loads.

Every push to `main` redeploys.

## Making changes with Claude Code

Clone the repo and open it in Claude Code. `CLAUDE.md` gives it the KPI rules, the ids and the
layout, so you can ask for changes directly ("add Cheryl as an agent", "show a weekly view").
Run `npm test` after any change to `src/kpi.js`.
