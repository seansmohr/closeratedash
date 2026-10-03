# Mohr Sales KPI Dashboard

Per-agent sales KPIs for Mohr Insurance Services. A Node/Express app on Railway that pulls
GoHighLevel contacts, the GoHighLevel calendar and the Production Sheet every 15 minutes, computes the KPIs, and serves a
dashboard behind Google sign-in (jmohrins.com accounts only).

## Commands

- `npm run dev`: local server on :3000 with made-up demo data, no sign-in, in-memory daily log
- `npm test`: unit tests for the KPI rules (`test/kpi.test.js`)
- `npm start`: production start (Railway runs this)

## Layout

- `src/kpi.js`: all KPI rules. Shared by the server (normalizes raw data) and the browser (served at
  `/kpi.js`, computes the selected month). Keep it dependency-free and UMD-wrapped.
- `src/ghl.js`: GoHighLevel `POST /contacts/search` (paginates with `searchAfter`) and
  `GET /calendars/events` (per agent, one month per request). Private Integration token with
  View Contacts and View Calendar Events
- `src/sheet.js`: Google Sheets values API with a service account
- `src/refresh.js`: scheduled pull; keeps the last good data per source in memory
- `src/store.js`: Postgres `daily_log` table (manual calls and confirmation counts)
- `src/auth.js`: Google OAuth, restricted to `ALLOWED_DOMAIN`; or one shared password (HTTP Basic)
  when `DASHBOARD_PASSWORD` is set
- `public/`: `index.html`, `app.js`, `styles.css`, sign-in page
- `test/fixtures/demo.js`: invented demo data. Never put real client data in the repo.

## The KPIs (agreed with Sean; don't add others without asking)

1. **Daily calls per agent**: entered by hand in the daily log (GoHighLevel's HIPAA setting blocks
   reading call logs through the API). Shown as the average per logged day.
2. **Held appointments**: past calendar appointments that weren't no-shows
3. **Close rate** = closes ÷ held
4. **Revenue per close and revenue per client**, each projected and confirmed. Per close averages
   each application. Per client adds up all of a client's applications in the selected period and
   divides by distinct clients, so a client who buys an add-on later is worth more than one close.
5. **Day-before confirmation calls**: entered by hand. Confirmation calls ÷ next-day appointments.
   Goal 2, ideal 3.
6. **Show rate** = held ÷ booked. Monthly and weekly.

## Rules

- **The Production Sheet is the source of truth for closes and revenue.** Each application
  (client + agent + App Date) is one close for the agent in the sheet's Agent column. Products sold
  the same day are one close; an add-on sale on a later day is its own close in its own month.
- **Weekly breakdown**: Monday-to-Sunday weeks that overlap the selected period, newest first
  (`KPI.weekly`). Same rules as the monthly scorecard, just bucketed by week.
- **Month = App Date** for sheet rows; **appointment date** for appointments.
- An application whose projected revenue nets to zero or less is **cancelled**: not a close, and
  excluded from revenue per client.
- **The GoHighLevel calendar is the source of truth for appointments.** Each calendar event is one
  booked appointment for the user it's assigned to (`assignedUserId`), on its start date in
  `TIMEZONE`. Left out: deleted, `cancelled` and `invalid` events, and anything that hasn't happened
  yet (today or later, unless already marked). Outcome (`KPI.normalizeAppointments`):
  - event `noshow`: no-show. Event `showed`: held
  - otherwise the contact's Appointment Status decides, for the contact's latest appointment only:
    `No Show…` → no-show; `Showed…`, `Sale…`, `Cancelled` → held; `Cancel/Reschedule` → not booked
  - anything else (still `confirmed`, status blank or on an earlier appointment): held, "unmarked";
    the dashboard has a toggle to exclude these
  - held = marked held + unmarked; booked = held + no-shows. Closes stay from the sheet, so a
    week's close rate can top 100% when sales are written up after the appointment week.
- **GoHighLevel contacts** supply the Appointment Status above and the Needs cleanup list: a contact
  marked `Sale (…)` with no sheet match (phone last 10 digits, or first+last name) is listed there
  and not counted as a close (Sean confirmed these are cancels).
- Contacts named `(Example) …` are skipped.
- Agents: Sai (`cnZtSKeOoW83yk308UNK`), Sean (`eOHtMUJYZPTqPz6ArpiR`), James
  (`bWlBo07jE3WGcdXeBhyv`). Anyone else shows as Unassigned. To add an agent, update `AGENT_BY_ID`
  and `AGENTS` in `src/kpi.js`; the sheet's Agent column must use the same name.

## Privacy

GoHighLevel is HIPAA-flagged. Raw contacts, calendar events and sheet rows stay in memory only; the app keeps
hashed match keys, dates, dollar amounts and outcomes. Client names reach the browser only for the
Needs cleanup list. Postgres holds only the daily log. Don't log contact data.

## Key ids

- GoHighLevel location `dTtT96ODx29mbQcdOp0v`; Appointment Status field `swdRjiAcFZNMfXztLD0g`;
  webinar date field `MW85KtwyuHBreKUD5aRo`
- Master Production Live Feed sheet `1oQeRPTmqfCarESRfVO5Kr0farkIo9yVOOH-vzidckwg` (IMPORTRANGE of
  the master's Production Sheet tab). Master workbook `1YVvXDVkLQmjQ8zgWlC_Ax-qiP9u8uh2wQfALA53KhOc`.
