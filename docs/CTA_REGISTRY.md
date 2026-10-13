# aapadmin CTA Registry & Testing Queue — canonical source of truth

The **one** CTA inventory, queue, evidence log and bug list for aapadmin. Do not create
a second one — extend this file. Sibling of `docs/REPORTS_REGISTRY.md` (reports/exports
surfaces stay there; this file links to it rather than duplicating them).

**Governance note:** the CTA prompt references `BZNUS_EXECUTION_CONSTITUTION.md`,
MASTER-131, Task Control, Test Phases, Bug Reporter and an evidence ledger. **None of
these exist in this repository** (they belong to a different codebase — see the same
finding in `REPORTS_REGISTRY.md`). This file is therefore the canonical home of the CTA
operating protocol, queue and evidence; no constitution was created. If a constitution
is ever added here, move "Operating protocol" into it and leave a pointer.

**Environment limits (honest baseline):** no `.env.local`/DB in the agent container and
no staging DB yet (`STAGING.md` describes setting one up), so route-integration and end-to-end checks that need
MySQL cannot run here. Tests use Node's built-in runner (`node --test src/lib/*.test.mjs`)
against pure modules with injected dependencies. Nothing in this file is *production
verified*.

---

## Operating protocol

**Statuses:** `NOT STARTED` → `QUEUED` → `IN PROGRESS` → `TESTED` → `CERTIFIED`, plus
`BLOCKED` (reason + next action required) and `NEEDS RETEST` (code changed since evidence).

**Verification levels** (always state which one evidence reaches):
`L1 component/unit` · `L2 route integration` (real handler + DB) · `L3 end-to-end outcome`
(browser → API → DB → UI) · `L4 production`. `TESTED` = L1 passing with no open P0/P1 on
that CTA. `CERTIFIED` = L3 passing, permissions enforced, data change confirmed, no open
critical defect. Never certify from a screenshot or "the button clicks".

**Priority:** P0 security/privacy/data loss/unauthorized action/broken login or signup ·
P1 core function, broken forms/links/navigation, high-value conversion · P2 UI/UX,
accessibility, mobile · P3 enhancements.

**Queue order (deterministic):** priority, then a `NEEDS RETEST`/`QUEUED` item before
`NOT STARTED`, then registry ID. `BLOCKED` items are skipped until their blocker changes.

**Stable CTA identity:** `CTA-<AREA>-<NNN>` = capability + route + action (+ context);
never visible text alone. One ID covers every rendered instance of the same action; add
a separate ID only when behaviour differs (role, tenant, endpoint).

**Commands:**
- `Test Next CTA` — (1) re-open the *Last worked* CTA below, finish its safe open tasks,
  re-run its tests, update its row; (2) take the first eligible queue row; reproduce →
  diagnose → fix (small, reuse existing code) → test → update row, bug list, run log;
  (3) set *Next recommended*. One focused commit per CTA.
- `CTA Queue` / `CTA Progress` / `Report CTA: X` — read this file only, rerun nothing.
- `Resume CTA` — continue the *Current* pointer. `Test CTA: X` / `Deep Test CTA: X` — target one.
- `Retry Blocked CTAs` — only rows whose blocker text has changed.
- `Test All CTAs` — sequential within the active session only; no background runner exists.
- Discovery: `node scripts/cta-inventory.mjs` (full) or `--since <ref>` (incremental).
  A counted element is a *discovered* CTA, not a tested one.

**Never:** real payments, bulk SMS/WhatsApp, writes to the production DB, merges or
deploys without authorization; closing a task that needs credentials/production access.

---

## Pointers

| | CTA | Note |
|---|---|---|
| **Last worked** | CTA-WF-002 | Atomic OTP verify — TESTED (L1) |
| **Current** | — | |
| **Next recommended** | CTA-REG-002 | Same parallel-brute-force race in `src/lib/registrationOtp.js:129-142` (`/join` + `/r/[token]` verify) |

**Progress:** 39 CTAs inventoried · 0 CERTIFIED · 1 TESTED (L1) · 0 BLOCKED · 38 remaining.
Discovery @ `046533b`: 99 files, 610 buttons, 56 links, 35 submits, 91 programmatic
navigations, 10 uploads (`node scripts/cta-inventory.mjs`).

---

## Queue

Columns: ID · Route · Action → API · Role · Pri · Status · Level · Evidence/tests · Bugs

### Public — worker form, registration, login

| ID | Route | Action → API | Role | Pri | Status | Lvl | Evidence | Bugs |
|---|---|---|---|---|---|---|---|---|
| CTA-WF-002 | /worker-form | Verify OTP → `POST /api/worker-form/verify-otp` | public | P0 | TESTED | L1 | `workerFormOtpVerifyCore.test.mjs` (6) | BUG-001 fixed |
| CTA-REG-002 | /join | Verify OTP → `POST /api/public/registration/join/verify` | public | P0 | QUEUED | — | — | BUG-002 |
| CTA-REG-003 | /r/[token] | Verify OTP → `POST /api/public/registration/[token]/otp/verify` | public (token) | P0 | QUEUED | — | — | BUG-002 |
| CTA-AUTH-001 | /login | Sign in → next-auth credentials (`src/lib/auth.js`) | staff | P0 | QUEUED | — | — | BUG-003 |
| CTA-WF-001 | /worker-form | Send OTP → `POST /api/worker-form/request-otp` | public | P0 | QUEUED | — | — | BUG-004 |
| CTA-WF-003 | /worker-form | Resend OTP → `POST /api/worker-form/resend-otp` (shares WF-001 handler) | public | P0 | QUEUED | — | — | BUG-004 |
| CTA-REG-001 | /join | Send/Resend OTP → `…/join/request`, `…/join/resend` | public | P0 | NOT STARTED | — | — | |
| CTA-REG-004 | /join, /r/[token] | Submit registration → `POST /api/public/registration` | public (verified) | P0 | NOT STARTED | — | — | |
| CTA-REG-005 | /join | Photo upload → `…/join/user-photo`, `…/join/worker-photo`, `…/photo` | public (verified) | P0 | NOT STARTED | — | — | |
| CTA-WF-004 | /worker-form | Submit form → `POST /api/worker-form/submit` | public (verified) | P0 | NOT STARTED | — | static review: identity from session only, values capped | |
| CTA-WF-005 | /worker-form | Sign out → `POST /api/worker-form/logout` | public | P1 | NOT STARTED | — | — | |
| CTA-REG-006 | /join, /r/[token] | Sign out → `…/join/logout`, `…/[token]/otp/logout` | public | P1 | NOT STARTED | — | — | |
| CTA-AUTH-002 | /dashboard (layout) | Sign out → next-auth `signOut` + `/api/logout-mark` | staff | P1 | NOT STARTED | — | — | |

### Admin / superadmin

| ID | Route | Action → API | Role | Pri | Status | Lvl | Evidence | Bugs |
|---|---|---|---|---|---|---|---|---|
| CTA-ADM-001 | /dashboard/admin/users | Create/edit/deactivate user → `/api/users`, `/api/users/[id]` | admin | P0 | NOT STARTED | — | — | |
| CTA-ADM-002 | /dashboard/admin/approvals | Approve/reject designation → `/api/designation-approvals` | admin | P0 | NOT STARTED | — | — | |
| CTA-ADM-003 | /dashboard/admin/portal-accounts | Create/revoke portal account → `/api/portal` | admin | P0 | NOT STARTED | — | — | |
| CTA-ADM-004 | /dashboard/admin/settings | Save settings / import polling master → `/api/admin/*` | superadmin | P1 | NOT STARTED | L1 (partial) | `pollingImportCore.test.mjs` | |
| CTA-ADM-005 | /dashboard/admin/integrations | Toggle plugin/integration → `/api/plugins` | superadmin | P1 | NOT STARTED | — | — | |
| CTA-ADM-006 | /dashboard/admin/teams, /teams/[id] | Create team / add member → `/api/teams` | admin | P1 | NOT STARTED | — | — | |
| CTA-ADM-007 | /dashboard/admin/number-corrections | Approve/reject correction → `/api/number-corrections/[id]` | admin | P1 | NOT STARTED | — | — | |
| CTA-ADM-008 | /dashboard/admin/vacancies | Send reminder → `POST /api/vacancies/remind` (outbound messages: mock only) | admin | P1 | NOT STARTED | — | — | |
| CTA-ADM-009 | /dashboard/admin/events | Create/edit event → `/api/events`, `/api/events/[id]` | admin | P1 | NOT STARTED | — | — | |
| CTA-ADM-010 | /dashboard/admin/complaints | Update complaint status → `/api/complaints` | admin | P1 | NOT STARTED | — | — | |
| CTA-ADM-011 | /dashboard/admin/influencers | Add/edit influencer → `/api/influencers` | admin | P1 | NOT STARTED | — | — | |
| CTA-ADM-012 | /dashboard/admin/voter-registration | Export/manage registrations → `/api/registration/*` | admin | P1 | NOT STARTED | — | see REPORTS_REGISTRY | |
| CTA-ADM-013 | /dashboard/admin/contacts | Edit/assign contact → `/api/contacts` | admin | P1 | NOT STARTED | — | — | |

### Staff workflows (caller, supervisor, departments)

| ID | Route | Action → API | Role | Pri | Status | Lvl | Evidence | Bugs |
|---|---|---|---|---|---|---|---|---|
| CTA-WS-001 | /dashboard/workspace | Claim / release / top-up queue → `/api/workspace/{claim,release,topup}` | caller | P1 | NOT STARTED | — | — | |
| CTA-WS-002 | /dashboard/workspace | Log call outcome / follow-up → `/api/calls`, `/api/workspace/follow-ups` | caller | P1 | NOT STARTED | L1 (partial) | `callerMetrics.test.mjs` | |
| CTA-CALL-001 | /dashboard/calls/new | Submit call → `POST /api/calls` | caller | P1 | NOT STARTED | — | — | |
| CTA-TASK-001 | /dashboard/tasks | Create / complete / bulk-paste task → `/api/tasks*` | staff | P1 | NOT STARTED | L1 (partial) | `taskGrouping.test.mjs` | |
| CTA-SUP-001 | /dashboard/supervisor/follow-ups, /contacts | Reassign / update contact → `/api/supervisor/*` | supervisor | P1 | NOT STARTED | — | — | |
| CTA-CMP-001 | /dashboard/complaints | File complaint → `/api/complaints` | staff | P1 | NOT STARTED | — | — | |
| CTA-LA-001 | /dashboard/leader-assessment | Save assessment → `/api/leader-assessment` | staff | P1 | NOT STARTED | — | — | |
| CTA-MED-001 | /dashboard/media (+ channels, newspapers) | Create press note/debate/conference, upload → `/api/media/*` | media | P1 | NOT STARTED | — | — | |
| CTA-SOC-001 | /dashboard/social-management | Create/publish post, add page → `/api/social-management/*` | social | P1 | NOT STARTED | — | — | |
| CTA-RPT-001 | /dashboard/reports, /reports-print | Run / save / export / print report → `/api/reports` | staff | P1 | NOT STARTED | — | see REPORTS_REGISTRY | |
| CTA-PRF-001 | /dashboard/profile | Update profile / photo → `/api/users/me/*` | staff | P1 | NOT STARTED | — | — | |
| CTA-POR-001 | /dashboard/portal/announcements | Post announcement → `/api/announcements` | portal | P1 | NOT STARTED | — | — | |
| CTA-NAV-001 | /dashboard (layout) | Sidebar / menu navigation (permission-filtered) → `/api/sidebar` | all | P2 | NOT STARTED | — | — | |

---

## Bugs

| ID | CTA | Pri | Status | Summary |
|---|---|---|---|---|
| BUG-001 | CTA-WF-002 | P0 | FIXED (L1) | Verify read `attempts`, compared, then incremented in separate statements, so parallel guesses all read the same count: 200 parallel guesses were accepted and the right one minted a session (MAX 5). Consume was also unconditional, so parallel correct submissions each minted a session. Fix: `src/lib/workerFormOtpVerifyCore.js` reserves an attempt with a conditional `UPDATE … AND attempts < ?` and consumes with `… AND consumed_at IS NULL`, checking `affectedRows`. |
| BUG-002 | CTA-REG-002/003 | P0 | OPEN | Same read-compare-increment pattern in `src/lib/registrationOtp.js:129-142` (`reg_otp_sessions`). Reuse the BUG-001 approach. |
| BUG-003 | CTA-AUTH-001 | P0 | OPEN | Staff credentials sign-in (`src/lib/auth.js` `authorize`) has no failed-attempt throttle or lockout, so passwords can be brute-forced online. Needs a design choice (per-username + per-IP counter table); confirm before implementing. |
| BUG-004 | CTA-WF-001/003 | P1 | OPEN | OTP send rate limit is check-then-insert (`src/lib/workerFormOtpHandler.js`); parallel requests can pass the hourly cap/cooldown and send extra SMS (cost abuse, not auth bypass). Fix: a per-phone `GET_LOCK` (via `withConnection`) or a conditional insert. |

---

## Run log

| Date | Commit | CTA | Result |
|---|---|---|---|
| 2026-10-13 | (this change) | first run | Audited infra (none existed), added `scripts/cta-inventory.mjs` + this registry, inventoried 39 workflow CTAs. CTA-WF-002: reproduced BUG-001 with a concurrent harness (old logic: 200 attempts, 1 session), fixed, `node --test src/lib/*.test.mjs` → 37/37 pass. L2/L3 not run: no DB in container. |

### CTA-WF-002 report card

| Category | Result |
|---|---|
| Functional correctness | Pass (L1): correct OTP → session; wrong → 400 counted; expired → 400 not counted; replay → 400 |
| Security | Pass (L1): lockout holds under 200 parallel guesses; single-use under parallel correct submits |
| Data integrity | Pass (L1): attempts never exceed MAX; exactly one consume |
| UI/UX · Accessibility · Mobile | Not re-tested this run (static: native `<form>`, submit disabled while busy) |
| API integration · E2E · Performance | Not run — needs DB (L2/L3) |
| Launch readiness | TESTED, not CERTIFIED — remaining: L2/L3 run against a staging DB |
