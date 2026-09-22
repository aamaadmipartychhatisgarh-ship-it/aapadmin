# aapadmin Reports Registry — canonical source of truth

Built under the 4-phase Reports certification pass (Phase 1: Discovery). This is the
**one** registry for every report/analytics/export surface in aapadmin. Do not create a
second one — extend this file instead.

**Governance note:** aapadmin has no CertificationService / Task Control / Evidence
Ledger / Launch Meter (those are a different codebase's concept). This registry, plus
honest status labels per item, is the closest equivalent that actually exists here.
Status values follow the same discipline in spirit: DOCUMENTED / IMPLEMENTED /
TESTED / VERIFIED — never inflated to a stronger claim than the evidence supports.

**Test infrastructure baseline (Phase 1 finding):** aapadmin has almost no automated
tests — 2 files total (`taskGrouping.test.mjs`, `pollingImportCore.test.mjs`), run via
Node's built-in runner (`node --test <file>`), no framework/config, no `test` script in
`package.json`. Any "TESTED" status below means a test was added or already existed for
that specific thing — not that this codebase has general test coverage.

**Verification method used throughout:** read-only queries against the real database
(`.env.local` — the same DB used in production; see aapadmin-deploy-and-push memory:
there is no local/staging DB in this environment) via a temporary script inside the
project (mysql2 resolves `node_modules` relative to the script's own path, not `cwd`),
deleted immediately after use. No writes were performed.

---

## Universal Reports Engine — 14 modules (`/dashboard/reports`)

Architecture: `src/lib/reports/registry.js` (module descriptors) → `src/lib/reports/engine.js`
(query builder) → `src/app/api/reports/route.js` (API) → `src/app/dashboard/reports/page.js` (UI).
Every module shares: parameterized SQL (no injection surface), server-enforced role+geo
scoping (`scopeFilterSync`), Table/Summary/Chart views, CSV/XLSX/analytical-PDF export,
Print, Share-Report link (`src/lib/reportShares.js`).

| # | Module | Table(s) | Scope cols | Access | Canonical calc used | Status |
|---|---|---|---|---|---|---|
| 01 | Calls | `calls` | zone/district/assembly | oversight | sentiment: raw input, single write path (`calls/route.js:331` for wrong-number classification) | IMPLEMENTED, VERIFIED (query shape tested against real schema) |
| 02 | Contacts | `contacts` | zone/district/assembly | oversight | — | IMPLEMENTED, VERIFIED |
| 03 | Wrong Numbers | `contacts` (is_wrong_number=1) | zone/district/assembly | oversight | single rule: `statusName === "Wrong Number"` (`calls/route.js:331`) — no duplicate classification found | IMPLEMENTED, VERIFIED |
| 04 | Workers | `workers` | zone/district/assembly | oversight | **activity_score: NO REAL CALCULATION** (see Known Gaps) | IMPLEMENTED but carries a data-quality gap |
| 05 | Tasks | `tasks` | district | oversight | grouping logic tested (`taskGrouping.test.mjs`, 9 passing cases) | IMPLEMENTED, TESTED |
| 06 | Complaints | `complaints` | district/assembly | oversight | — | IMPLEMENTED, VERIFIED |
| 07 | Attendance | `attendance_log` | none (role-gated instead) | admin tiers + supervisor | — | **FAIL — see GAP-3** |
| 08 | Users | `users` | none | super_admin/state_admin only | — | IMPLEMENTED, VERIFIED |
| 09 | Teams | `teams` | none | oversight | avg activity reuses the same (gap-carrying) activity_score column | **FAIL — see GAP-3** |
| 10 | Notifications | `notifications` | none | super_admin/state_admin only | — | IMPLEMENTED, VERIFIED |
| 11 | Audit Log | `audit_logs` | none | super_admin/state_admin only | — | IMPLEMENTED, VERIFIED |
| 12 | Press Notes & Coverage | `press_notes` | none | oversight | — | IMPLEMENTED, VERIFIED |
| 13 | TV Debates | `debates` | none | oversight | — | IMPLEMENTED, VERIFIED |
| 14 | Press Conferences | `press_conferences` | none | oversight | — | IMPLEMENTED, VERIFIED |

**Index coverage:** extended in the prior pass (commit `a84bf27`) to all 14 modules'
time-filter columns, both `scripts/add-report-indexes.mjs` (production maintenance
script) and `src/lib/reports/ensureIndexes.js` (dev-only, `REPORTS_AUTO_INDEX=1` opt-in).
Not yet independently re-verified this pass (no code change since — reusing that
evidence per the no-repeat-testing rule).

## Standalone report surfaces

| Surface | Route | Canonical calc source | Status |
|---|---|---|---|
| Caller Report | `api/admin/caller-report` | **Connect rate: single inline calculation** (`(connected/total)*100`, two call sites in the same file) — see Phase 2 (extracted to a shared, tested function this pass) | IMPLEMENTED, TESTED (this pass), VERIFIED (territory scoping fixed + SQL-verified in a prior pass) |
| Supervisor PDF Export | `api/supervisor/export/[report]` | reuses `calls`/`locations`, no independent metric formulas | IMPLEMENTED, VERIFIED (territory scoping fixed + SQL-verified in a prior pass) |
| Rankings | `api/rankings` → `RankingsView` | worker membership %, area % — not re-derived this pass; reused across 3 surfaces via the same component/API (Rankings, Full Ranking, Analytics) — **one calculation, confirmed by code reuse, not re-tested** | REUSE CONFIRMED (prior pass), not re-verified this pass (no change) |
| Full Ranking | `dashboard/full-ranking` | composes Rankings + Strength + State Overview — no independent calculation | REUSE CONFIRMED |
| Analytics | `api/analytics` → `AnalyticsPanel` | 7 chart panels; district-strength coloring reuses `districtWorkerStats()`, same source as Strength/Map | REUSE CONFIRMED |
| Strength | `api/strength` → `StrengthView` | `districtWorkerStats()` — **the one canonical Strength calculation**, confirmed shared by Strength, Map, Analytics, Rankings' area view | REUSE CONFIRMED |
| Map | `api/map` | consumes `districtWorkerStats()` — does not recreate Strength | REUSE CONFIRMED |
| Audit (standalone page) | `dashboard/admin/audit` | same `audit_logs` table as the Engine module, simpler UI; nav-linked as of the prior pass | IMPLEMENTED, VERIFIED |
| Contacts Hierarchy | `api/contacts/hierarchy` | pure read-only drill-down | IMPLEMENTED, VERIFIED |
| Contacts Incomplete | `api/contacts/incomplete` | — | IMPLEMENTED, VERIFIED |
| Repeat-Off | `api/contacts/repeat-off` | **`REPEAT_OFF_THRESHOLD` + `repeatOffSelect` in `src/lib/repeatOff.js`** — one shared module, imported by 4 consumers (`repeat-off`, `contacts`, `supervisor/contacts`, `statuses`) — confirmed canonical, no duplication | IMPLEMENTED, VERIFIED |

## Workflow surfaces with an embedded report/export (not primarily reports)

| Surface | Note |
|---|---|
| Wrong Numbers Admin | Operational (restore/reassign); reuses the same `is_wrong_number` classification, not a second one |
| Number Corrections | State-machine workflow; own export path, not yet audited against Universal Export for consolidation |
| Leader Assessment | Full CRUD system with 3 of its own exporters (candidates/mlas/comparison) — out of this pass's scope, flagged for a future pass |
| Voter Registration | CRUD + own CSV export + dashboard summary — same flag as above |

---

## Known Gaps (Phase 3 additions below GAP-2; Phase 1 findings above)

### GAP-3 — Teams and Attendance reports have NO territory scoping (FAIL + POLICY AMBIGUOUS)
**Evidence (code review, this pass):** `src/lib/reports/engine.js:80` only applies
`scopeFilterSync` when a module declares `scopeCols` — a list of column names
(`zone_id`/`district_id`/`assembly_id`) that must exist directly on the module's own
aliased table. Two of the 14 modules have no such columns to declare and currently
declare no `scopeCols` at all:

- **Teams** (`registry.js:476-506`): `teams.location_id` is a single FK that can point
  to a location at ANY hierarchy level (state/zone/lok_sabha/district/assembly/ward/
  mandal/booth — see the module's own `level` filter options). The existing
  `scopeFilterSync`/`geoFilter` helpers are both built for tables with separate
  zone/district/assembly columns and cannot resolve a single variable-level FK.
- **Attendance** (`registry.js`, `access()` restricted to admin tiers + supervisor,
  no `scopeCols`): the district a user belongs to lives on the JOINED `users` row
  (`u.home_district_id`), not on `attendance_log` itself — `scopeCols` only checks
  columns on the module's own primary alias, so it cannot reach through the join.

**Impact:** any oversight role that passes the (correctly working) role gate — down to
`assembly_admin` — currently sees ALL teams and ALL attendance records platform-wide
through the Reports Engine, not just their own territory's.

**Why this is FAIL + POLICY AMBIGUOUS, not just implemented as a fix:** the mechanical
absence of restriction is unambiguously wrong (FAIL). But the *correct* rule needs a
decision this pass won't make unilaterally, matching the framework's own instruction not
to invent authorization semantics:
- Teams: should a district_admin see a zone-level or state-level team whose location
  happens to contain their district? Only teams at-or-below their exact level? This is
  a real hierarchical-visibility policy question.
- Attendance: should a district_admin see attendance for a supervisor or another admin
  tier working across multiple districts, or only base-tier staff physically in their
  district? Attendance rows aren't naturally "owned" by one territory the way a contact
  or call is.

**What a fix would need (not implemented, pending the decision above):** `engine.js`
would need a new, optional per-module hook — a function of `session.user` returning
`{where, params}` — parallel to the existing `baseWhere` (static) hook, so Teams/
Attendance can express a bespoke scope without forcing every one of the other 12
modules through a new code path. This is an `engine.js` change (shared by all 14
modules), so it should be built once both policy questions are answered, not twice.

**Softer, lower-confidence note (same absent-`scopeCols` pattern, not classified FAIL):**
Press Notes, TV Debates, Press Conferences also declare no `scopeCols` — any oversight
role sees all media/PR content platform-wide. Unlike Teams/Attendance, this may well be
*correct by design*: press coverage and debates are plausibly state-wide-relevant
content, not territory-owned operational data the way a contact or a call is. Noted for
completeness, not asserted as a defect without product confirmation either way.

---

## Known Gaps (Phase 1 duplication + source-of-truth audit)

### GAP-1 — Worker Activity Score has no real calculation (OWNER DECISION required)
**Evidence (read-only, live DB, this pass):** 7,245 workers total; 6,976 (96.3%) have
`activity_score = 0`; only 3 distinct values exist database-wide (0, and two others up
to 50); the top 5 "most active" workers by this column are all `status='pending'` (not
even approved members) and all share the identical value `50` — the signature of a
static import/seed value, not a live metric. `workers` has no `updated_at` column at
all, so there's no way any row was ever recalculated after creation. No application
code path (`grep` across `src/` and `scripts/`) ever writes `activity_score` — the only
writer of the `workers` table (`src/lib/membershipSchema.js`) never touches this column.

**Why this is OWNER DECISION, not something I fixed:** "Activity" needs a real
definition — calls made, tasks completed, login frequency, some weighted mix — and
that is a product/business decision for a political-organizing platform, not something
to invent unilaterally. Per this pass's own rule ("do NOT invent or modify ranking
rules simply to improve the displayed result"), the same restraint applies here.

**Where it's consumed (all inherit the gap until resolved):** Workers report (Engine
module 04), Teams average-activity display, `api/notifications`'s "weak districts"
query, sort-by-activity on the Workers list.

**Safe action taken:** documented here; no display was hidden or silently "fixed" with
an invented formula, since removing a column admins may already reference is itself a
UX decision I won't make unilaterally either.

---

## Report Contract coverage (Global Rule 4)

| Capability | Engine's 14 modules | Standalone surfaces |
|---|---|---|
| Table / Summary / Chart | ✅ all 14 | N/A (each has its own fixed view) |
| Filters | ✅ declared per module | ✅ where applicable |
| Export (CSV/XLSX/PDF) | ✅ all 14 | Caller Report/Supervisor Export: PDF only; others: mixed |
| Print | ✅ all 14 | not audited this pass |
| Share | ✅ all 14 (`reportShares.js`) | not available outside the Engine |
| Permission | ✅ server-side, `scopeFilterSync` + module `access()` | ✅ (2 surfaces fixed for territory scoping in the prior pass) |
| Analytics (usage tracking) | ⚪ NOT VERIFIED — no event-tracking call found in `route.js`/`engine.js` this pass | ⚪ NOT VERIFIED |
| Evidence/Certification | N/A — no CertificationService exists in this codebase | N/A |

**Analytics gap note:** unlike BZNUS's `EventIngestService`, aapadmin has no generic
event-tracking call found in the Reports Engine's request path this pass. This means
`report_open`/`report_filter`/`report_export`/`report_share` usage events — asked for
by the certification framework this pass follows — are **not currently tracked as a
metric anywhere**, only usable via server access logs at best. Flagged as a real gap,
not fabricated as present.
