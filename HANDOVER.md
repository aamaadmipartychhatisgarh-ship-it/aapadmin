# Handover Notes — AAP Admin

For the developer taking over this project. This lists what's complete, what's
incomplete by design, known issues to review, and suggested improvements.
See `SETUP.md` for how to run it.

---

## What works (verified, fully functional)

- **Auth & roles** — NextAuth credentials login; 8-role hierarchy with geographic scoping
- **Calling operations** — workspace (claim contacts), log a call, call history, timer
- **Tasks** — create/assign/track, per-role scoping
- **Complaints** — log, track, resolve
- **Workers / Teams** — CRUD, CSV upload, team membership
- **Media center** — newspapers, channels, debates, press conferences, spokespersons, journalists (manual CRUD)
- **Social management** — manual post/page logging (no live platform APIs — see below)
- **Rankings, Strength meter, Map, Analytics (9 chart types), Reports (Excel export)**
- **Supervisor dashboard** — live status, caller performance, attendance, sentiment, alerts, areas
- **Admin settings** — statuses, designations, locations
- **Responsive** — mobile drawer sidebar, works on phone + desktop

---

## Incomplete features (intentional placeholders — NOT bugs)

These were deliberately scoped out and show a clear "not enabled" message in the UI:

1. **Social platform API integration** — `src/app/dashboard/social-management/page.js`
   — manual logging only. No real posting to Facebook/Instagram/WhatsApp/YouTube.
   (Client decided "manual only, no AI, no real posting.")
2. **Social War Room live feed** — `src/app/dashboard/social/page.js` shows demo/seeded data, not a live social feed.
3. **Worker QR/Aadhaar import** — `src/app/dashboard/admin/workers/page.js` — stub ("leave photo and aadhaar for now" per client).
4. **Training certificates** — `src/app/dashboard/training/page.js` — certificate issuance is a placeholder label.

If the client wants any of these for real, they are net-new features, not fixes.

---

## Known issues to review (prioritized)

### Critical — secrets
- **`.env.production` contains real DB credentials and a weak `NEXTAUTH_SECRET`**
  (`super_secret_key_change_in_production_123456789`). For the web deployment the
  real values live in the Hostinger panel, but the file in the repo still has
  live-looking creds. **Action:** rotate the DB password, generate a strong
  `NEXTAUTH_SECRET`, and consider removing `.env.production` from the repo
  entirely (it's no longer needed now that it's web-only on Hostinger).

### Important — geographic scoping gaps
Some **supervisor** endpoints query state-wide data with no `scopeFilterSync`:
`api/supervisor/sentiment`, `alerts`, `remarks`, `follow-ups`, `live`,
`areas`, `attendance`. This is fine IF supervisors are meant to be state-wide
(the current role model treats supervisor as cross-cutting oversight). But the
**Reports/export** endpoints (`api/reports/export/[type]`,
`api/supervisor/export/[report]`) also lack scoping — a scoped admin could export
all-state data. **Action:** decide the intended policy, then add scoping to the
export routes at minimum.

- **Field-level scope on PUT routes** — `workers/[id]`, `teams/[id]`,
  `contacts/[id]`, `tasks/[id]` check role but not that the target row is in the
  admin's territory. A district admin could edit a row outside their district if
  they know its id. **Action:** add a territory check before update.

### Robustness
- **`api/admin/overview`** — if a date range has zero rows, the `[[cur]]`
  destructure can yield `undefined` and `numerify(undefined)` may throw. Add a
  null guard.
- **PUT/DELETE routes don't 404** when the id doesn't exist — they return 200
  with 0 rows affected. Frontend then shows false success. Add existence checks.
- **CSV upload** (`workers/upload-csv`, `contacts/upload-csv`) — minimal
  validation; bad district/assembly ids rely on FK errors. Add validation.

> NOTE: An earlier automated audit flagged `api/calls/[id]` line 38 as a bug
> (`rows.user_id`). It is NOT a bug — `query()` returns the rows array, so
> `const [rows]` is the first row object and `rows.user_id` is correct.

---

## Suggested improvements (nice-to-have)

- **Tests** — there are none. Start with `lib/permissions.js` (scope functions)
  and a few critical API routes.
- **Input validation** — `zod` is a dependency but unused; routes hand-check
  fields. Migrate POST/PUT bodies to zod schemas.
- **Large components** — `dashboard/media/page.js` (~570 lines),
  `workspace/page.js`, `analytics/page.js` mix fetch + state + UI. Extract hooks.
- **Error handling consistency** — only some routes map `ER_DUP_ENTRY` → 409;
  standardize a small error helper.
- **Pre-commit lint** — `npm run lint` exists but isn't enforced; add husky.
- **Favicon** — currently a `.jpg` (the AAP logo). A transparent PNG/ICO would
  be slightly crisper.

---

## Key files map

| Area | File |
|---|---|
| Roles + scoping | `src/lib/permissions.js` |
| Auth config | `src/lib/auth.js` |
| DB pool / query | `src/lib/db.js` |
| App shell / nav / responsive | `src/app/dashboard/layout.js` |
| Login UI | `src/components/ui/sign-in.jsx` |
| API routes | `src/app/api/**` |
| DB migrations + seeds | `scripts/*.mjs` |
| Deploy | Hostinger Node app, auto-deploy on push to `master` |
