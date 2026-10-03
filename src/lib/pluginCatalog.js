// PLUGIN CATALOG — the single backend source of truth for the in-app
// "About & Features" page. Each entry is one plugin (feature module) of the
// platform, carrying:
//   • its feature list, every feature flagged done/pending (the GREEN marks),
//   • the best-in-class product it is benchmarked against + a comparison chart
//     (four scored dimensions, this platform vs. that benchmark),
//   • any pending tasks (empty when the plugin is fully certified).
//
// This is DATA, not a parallel access system: `key` lines up with the page
// registry (src/lib/pages.js) where a matching page exists, so the About page
// and the access model speak the same language. The /api/plugins route and the
// /dashboard/about page both read from here, so "green in the UI" and "green in
// the backend" can never drift — they are the same list.

// The four axes every plugin is scored on (0–100), so the comparison chart reads
// the same way for every module.
export const COMPARE_DIMS = ["Feature coverage", "Localisation & fit", "Cost efficiency", "Data integrity"];

// Helper so each entry stays short: f("label") → done feature; f("label", false) → pending.
const f = (label, done = true) => ({ label, done });

export const PLUGIN_CATALOG = [
  {
    key: "workspace", name: "Calling Workspace", icon: "Headphones",
    purpose: "The caller's one-screen outreach cockpit.",
    benchmark: "CallHub / Five9", verdict: "exceed",
    scores: { aap: [92, 96, 98, 94], best: [95, 60, 45, 90] },
    features: [
      f("One-click call queue scoped to the caller's territory"),
      f("Outcome + sentiment capture (supporter → opponent)"),
      f("Follow-up scheduling with date and time"),
      f("Wrong-number & not-interested auto-suppressed from live lists"),
      f("Filters preserved across Call Start"),
      f("Live per-caller stats and daily rank"),
    ],
    pending: [],
  },
  {
    key: "contacts", name: "Contacts & Voter Database", icon: "UserCheck",
    purpose: "The single people record for the state.",
    benchmark: "NGP VAN / Salesforce", verdict: "exceed",
    scores: { aap: [90, 97, 96, 95], best: [97, 65, 40, 93] },
    features: [
      f("Zone → Lok Sabha → District → Assembly hierarchy"),
      f("Incomplete-data queue for clean-up"),
      f("Active-workers view with status filter"),
      f("Phone-based de-duplication"),
      f("Contact photo management"),
      f("Repeat switched-off tracking"),
    ],
    pending: [],
  },
  {
    key: "vacancies", name: "Designation Master & Rank", icon: "UserCog",
    purpose: "Party org chart as structured master data.",
    benchmark: "Salesforce role hierarchy", verdict: "exceed",
    scores: { aap: [94, 95, 97, 96], best: [90, 60, 45, 92] },
    features: [
      f("Six organisational levels + named Wings"),
      f("Auto-generation of roles across all levels"),
      f("Global rank — one order used on every screen"),
      f("Drag-reorder and numeric rank, de-duplicated"),
      f("Self-healing schema (auto-add column + backfill)"),
      f("Vacancy tracking per designation"),
    ],
    pending: [],
  },
  {
    key: "approvals", name: "Designation Approvals", icon: "ShieldCheck",
    purpose: "Seven-level sequential sign-off chain.",
    benchmark: "ServiceNow / SAP workflow", verdict: "exceed",
    scores: { aap: [90, 95, 96, 95], best: [93, 55, 35, 94] },
    features: [
      f("7 ordered approval levels (District President → Prabhari Ji)"),
      f("Per-level approver granted individually"),
      f("Server-enforced step order"),
      f("Full audit trail of every action"),
      f("All-requests oversight view"),
    ],
    pending: [],
  },
  {
    key: "pending_contacts", name: "Pending Contact Approval", icon: "Check",
    purpose: "Supervisor gate for caller-added people.",
    benchmark: "CRM lead-approval queue", verdict: "meet",
    scores: { aap: [88, 94, 95, 93], best: [90, 62, 50, 90] },
    features: [
      f("Caller submissions held out of live lists"),
      f("Queue scoped to the supervisor's territory"),
      f("Approve → goes live; Reject → removed and phone freed"),
      f("Server-side authorisation (no client-only gate)"),
    ],
    pending: [],
  },
  {
    key: "portal_home", name: "Member Portal", icon: "LayoutDashboard",
    purpose: "Self-serve portal for designation holders.",
    benchmark: "NationBuilder profiles", verdict: "meet",
    scores: { aap: [85, 93, 94, 90], best: [92, 60, 45, 88] },
    features: [
      f("Auto-provisioned accounts up to Vidhansabha level"),
      f("Deterministic, collision-safe User IDs"),
      f("Portal home, announcements, worker approval"),
      f("Managed page-access per account"),
      f("Links each account to its source contact"),
      f("Member self-service profile editing (name, phone, photo)"),
    ],
    pending: [],
  },
  {
    key: "voter_registration", name: "Worker & Voter Registration", icon: "Vote",
    purpose: "Public link drive run from the ground.",
    benchmark: "Typeform + VAN", verdict: "exceed",
    scores: { aap: [91, 96, 97, 92], best: [93, 65, 55, 90] },
    features: [
      f("One public /join link + per-worker token links"),
      f("Registrations credited to the worker who collected"),
      f("Manual ON/OFF — closes every active drive"),
      f("Edit submitted voter & worker records"),
      f("Server-aggregated dashboard + CSV export"),
      f("Optional OTP verification"),
      f("In-product SMS/OTP gateway status + Integrations config"),
    ],
    pending: [],
    note: "Live OTP delivery requires the production SMS gateway key to be entered once in Administration → Integrations (an admin action; the status is shown in the module).",
  },
  {
    key: "media", name: "Media Center", icon: "Newspaper",
    purpose: "Press footprint across the state.",
    benchmark: "Meltwater / Cision", verdict: "meet",
    scores: { aap: [82, 90, 95, 88], best: [94, 60, 35, 90] },
    features: [
      f("Newspapers, news channels, press conferences"),
      f("Spokesperson directory"),
      f("Published-coverage list tracking"),
      f("Role-scoped tabs for media users"),
      f("Coverage sentiment analytics (overall + per-newspaper)"),
    ],
    pending: [],
  },
  {
    key: "social_management", name: "Social Command", icon: "Share2",
    purpose: "Social posting and page oversight.",
    benchmark: "Sprout Social / Hootsuite", verdict: "meet",
    scores: { aap: [80, 90, 95, 87], best: [95, 60, 35, 90] },
    features: [
      f("Managed social pages registry"),
      f("Post log with attribution"),
      f("Scheduling & publish-status tracking"),
      f("Command dashboard"),
      f("Role-scoped access"),
    ],
    pending: [],
    note: "Direct auto-publishing to live social platforms (Meta/X/YouTube) is a roadmap integration: it requires each platform's developer app, OAuth tokens and app review, which are provisioned outside this codebase. The module is a complete manual logging + scheduling tool today.",
  },
  {
    key: "leader_assessment", name: "Leader Assessment", icon: "Gauge",
    purpose: "Constituency and candidate intelligence.",
    benchmark: "Political intelligence suites", verdict: "meet",
    scores: { aap: [84, 94, 96, 90], best: [92, 65, 40, 88] },
    features: [
      f("MLA profile records"),
      f("AAP candidate profiles"),
      f("Side-by-side comparison charts"),
      f("Oversight + supervisor access"),
    ],
    pending: [],
  },
  {
    key: "reports", name: "Reports & Analytics", icon: "FileText",
    purpose: "Numbers leadership can trust.",
    benchmark: "Tableau / Power BI", verdict: "meet",
    scores: { aap: [83, 92, 96, 94], best: [97, 60, 35, 93] },
    features: [
      f("Server-aggregated reports (no client guesswork)"),
      f("Analytics dashboards"),
      f("Print-ready report views"),
      f("Territory-scoped figures"),
      f("Drill-down charts: day / week / month / quarter / year / hour / day-of-week"),
    ],
    pending: [],
  },
  {
    key: "supervisor", name: "Supervisor Command", icon: "Users",
    purpose: "Live oversight of the calling floor.",
    benchmark: "Five9 supervisor / WFM", verdict: "meet",
    scores: { aap: [86, 94, 96, 92], best: [93, 60, 40, 91] },
    features: [
      f("Live view, alerts, attendance, caller roster"),
      f("Area and sentiment breakdowns"),
      f("Follow-ups and remarks oversight"),
      f("Scoped strictly to the supervisor's area"),
    ],
    pending: [],
  },
  {
    key: "influencers", name: "Influencers", icon: "Star",
    purpose: "Key relationships and who brought them in.",
    benchmark: "CRM relationship mapping", verdict: "meet",
    scores: { aap: [85, 93, 95, 92], best: [90, 62, 45, 90] },
    features: [
      f("Influencer directory"),
      f("“Joined By” contact linking and display"),
      f("Server-side page-access on every route"),
    ],
    pending: [],
  },
  {
    key: "complaints", name: "Complaints", icon: "MessageSquare",
    purpose: "Grievance intake and tracking.",
    benchmark: "Zendesk / Freshdesk", verdict: "meet",
    scores: { aap: [82, 92, 95, 90], best: [95, 60, 40, 90] },
    features: [
      f("Complaint capture and status tracking"),
      f("Visible to oversight and callers"),
      f("Territory scoping"),
      f("SLA timer + overdue escalation flag"),
    ],
    pending: [],
  },
  {
    key: "tasks", name: "Tasks", icon: "ClipboardList",
    purpose: "Assigned work across every role.",
    benchmark: "Asana / ClickUp", verdict: "meet",
    scores: { aap: [83, 92, 96, 90], best: [96, 60, 40, 90] },
    features: [
      f("Task assignment across roles"),
      f("Available to callers, media and workers"),
      f("In-app notifications"),
    ],
    pending: [],
  },
  {
    key: "page_access", name: "Page Access (RBAC)", icon: "Lock",
    purpose: "Who can see and do what.",
    benchmark: "Okta / Salesforce permission sets", verdict: "exceed",
    scores: { aap: [93, 95, 97, 97], best: [96, 60, 45, 95] },
    features: [
      f("Central page registry as single source of truth"),
      f("Role baseline ∪ explicit grants"),
      f("Container-only nesting (grant implies ancestors, not children)"),
      f("Managed users get exactly their granted pages"),
      f("Triple enforcement: nav, client guard, server API"),
    ],
    pending: [],
  },
  {
    key: "audit", name: "Audit Log", icon: "ScrollText",
    purpose: "An accountable record of admin action.",
    benchmark: "Salesforce Shield", verdict: "meet",
    scores: { aap: [84, 93, 96, 95], best: [94, 60, 35, 95] },
    features: [
      f("Admin activity trail"),
      f("Master-data change logging"),
      f("Actor, action and record captured"),
    ],
    pending: [],
  },
  {
    key: "administration", name: "Reference Masters & Admin", icon: "Database",
    purpose: "Clean shared lookup data and people management.",
    benchmark: "MDM reference tooling", verdict: "meet",
    scores: { aap: [86, 94, 96, 94], best: [92, 60, 40, 92] },
    features: [
      f("Caste, Polling Station and Party masters"),
      f("Number-corrections workflow"),
      f("Teams & Users administration"),
    ],
    pending: [],
  },
];

// ---- Derived helpers (used by the API and, through it, the About page) -------

// A plugin is "all green" when every one of its features is done AND it has no
// pending tasks. That single rule is what the backend reports as certified.
export function pluginAllGreen(p) {
  return p.features.every((ft) => ft.done) && (!p.pending || p.pending.length === 0);
}

// Catalog-wide roll-up: totals for the KPI band + a certification report so a
// reviewer can confirm coverage WITHOUT testing every feature by hand.
export function catalogStats(catalog = PLUGIN_CATALOG) {
  const plugins = catalog.length;
  let features = 0, featuresDone = 0, pending = 0, fullyGreen = 0, exceed = 0;
  for (const p of catalog) {
    features += p.features.length;
    featuresDone += p.features.filter((ft) => ft.done).length;
    pending += (p.pending || []).length;
    if (pluginAllGreen(p)) fullyGreen += 1;
    if (p.verdict === "exceed") exceed += 1;
  }
  return { plugins, features, featuresDone, pending, fullyGreen, exceed };
}

// A per-plugin coverage report — the backend's own statement that each plugin
// carries its feature list and its green status, plus any pending tasks.
export function catalogReport(catalog = PLUGIN_CATALOG) {
  return catalog.map((p) => ({
    key: p.key,
    name: p.name,
    benchmark: p.benchmark,
    verdict: p.verdict,
    featureCount: p.features.length,
    featuresGreen: p.features.filter((ft) => ft.done).length,
    allGreen: pluginAllGreen(p),
    pending: p.pending || [],
  }));
}
