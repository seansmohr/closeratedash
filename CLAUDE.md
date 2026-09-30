# Mohr Sales KPI Dashboard

Per-agent sales KPIs for Mohr Insurance Services. A Node/Express app on Railway that pulls
GoHighLevel contacts and the Production Sheet every 15 minutes, computes the KPIs, and serves a
dashboard behind Google sign-in (jmohrins.com accounts only).

## Commands

- `npm run dev`: local server on :3000 with made-up demo data, no sign-in, in-memory daily log
- `npm test`: unit tests for the KPI rules (`test/kpi.test.js`)
- `npm start`: production start (Railway runs this)

## Layout

- `src/kpi.js`: all KPI rules. Shared by the server (normalizes raw data) and the browser (served at
  `/kpi.js`, computes the selected month). Keep it dependency-free and UMD-wrapped.
- `src/ghl.js`: GoHighLevel `POST /contacts/search`, Private Integration token, paginates with `searchAfter`
- `src/sheet.js`: Google Sheets values API with a service account
- `src/refresh.js`: scheduled pull; keeps the last good data per source in memory
- `src/store.js`: Postgres `daily_log` table (manual calls and confirmation counts)
- `src/auth.js`: Google OAuth, restricted to `ALLOWED_DOMAIN`
- `public/`: `index.html`, `app.js`, `styles.css`, sign-in page
- `test/fixtures/demo.js`: invented demo data. Never put real client data in the repo.

## The five KPIs (agreed with Sean; don't add others without asking)

1. **Daily calls per agent**: entered by hand in the daily log (GoHighLevel's HIPAA setting blocks
   reading call logs through the API). Shown as the average per logged day.
2. **Held appointments**
3. **Close rate** = closes ÷ held
4. **Revenue per close and revenue per client**, each projected and confirmed. Per close averages
   each application. Per client adds up all of a client's applications in the selected period and
   divides by distinct clients, so a client who buys an add-on later is worth more than one close.
5. **Day-before confirmation calls**: entered by hand. Confirmation calls ÷ next-day appointments.
   Goal 2, ideal 3.

## Rules

- **The Production Sheet is the source of truth for closes and revenue.** Each application
  (client + agent + App Date) is one close for the agent in the sheet's Agent column. Products sold
  the same day are one close; an add-on sale on a later day is its own close in its own month.
- **Weekly breakdown**: Monday-to-Sunday weeks that overlap the selected period, newest first
  (`KPI.weekly`). Same rules as the monthly scorecard, just bucketed by week.
- **Month = App Date** for sheet rows. GoHighLevel records have no app date, so they use the
  webinar date (`Date - Webinar Time/Date`), falling back to the contact's last update.
- An application whose projected revenue nets to zero or less is **cancelled**: counts as held, not
  a close, and is excluded from revenue per client.
- **GoHighLevel supplies the no-sale side**, attributed to the contact owner (`assignedTo`):
  - `Showed` / `Showed 2`: held, no sale
  - Blank status + tag `scheduled` + webinar date before today: held, no sale ("unmarked"; the
    dashboard has a toggle to exclude these)
  - `No Show`, `No Show 2`, `No Show - Veteran`, `Cancel/Reschedule`, `Medicare (Imported)`,
    `IFP (Imported`: not counted
  - `Sale (…)` matched to a sheet row by phone (last 10 digits) or first+last name: ignored
    (already counted from the sheet)
  - `Sale (…)` with no sheet match: treated as **cancelled** (Sean confirmed these are cancels),
    listed under Needs cleanup
  - `Cancelled` (if added to the picklist): cancelled
- Contacts named `(Example) …` are skipped.
- Agents: Sai (`cnZtSKeOoW83yk308UNK`), Sean (`eOHtMUJYZPTqPz6ArpiR`), James
  (`bWlBo07jE3WGcdXeBhyv`). Anyone else shows as Unassigned. To add an agent, update `AGENT_BY_ID`
  and `AGENTS` in `src/kpi.js`; the sheet's Agent column must use the same name.

## Privacy

GoHighLevel is HIPAA-flagged. Raw contacts and sheet rows stay in memory only; the app keeps
hashed match keys, dates, dollar amounts and outcomes. Client names reach the browser only for the
Needs cleanup list. Postgres holds only the daily log. Don't log contact data.

## Key ids

- GoHighLevel location `dTtT96ODx29mbQcdOp0v`; Appointment Status field `swdRjiAcFZNMfXztLD0g`;
  webinar date field `MW85KtwyuHBreKUD5aRo`
- Master Production Live Feed sheet `1oQeRPTmqfCarESRfVO5Kr0farkIo9yVOOH-vzidckwg` (IMPORTRANGE of
  the master's Production Sheet tab). Master workbook `1YVvXDVkLQmjQ8zgWlC_Ax-qiP9u8uh2wQfALA53KhOc`.
