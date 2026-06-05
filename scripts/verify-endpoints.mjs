// Hits every GET endpoint as each role via the live dev server and reports
// any 500-level responses (server crashes) — the bugs that surface on an empty DB.
// Run with the dev server up on :3000.

const BASE = "http://localhost:3000";

const ROLES = [
  ["superadmin", "superadmin"],
  ["stateadmin", "stateadmin"],
  ["zoneadmin", "zoneadmin"],
  ["districtadmin", "districtadmin"],
  ["assemblyadmin", "assemblyadmin"],
  ["supervisor", "supervisor"],
  ["caller", "caller"],
  ["worker", "worker"],
];

// GET endpoints to probe (skip auth handlers, mutation-only, and dynamic [id] routes).
const GETS = [
  "/api/admin/overview",
  "/api/analytics",
  "/api/calls",
  "/api/complaints",
  "/api/contacts",
  "/api/designations",
  "/api/locations?type=district",
  "/api/map",
  "/api/me/scope",
  "/api/me/stats",
  "/api/media",
  "/api/media/spokespersons",
  "/api/media/journalists",
  "/api/notifications",
  "/api/rankings",
  "/api/social",
  "/api/social-management",
  "/api/statuses",
  "/api/strength",
  "/api/supervisor/alerts",
  "/api/supervisor/areas?level=district",
  "/api/supervisor/attendance",
  "/api/supervisor/callers",
  "/api/supervisor/follow-ups",
  "/api/supervisor/live",
  "/api/supervisor/remarks",
  "/api/supervisor/sentiment",
  "/api/supervisor/summary",
  "/api/tasks",
  "/api/teams",
  "/api/training",
  "/api/users",
  "/api/workers",
  "/api/workspace/queue",
];

async function getCookie(res) {
  const sc = res.headers.getSetCookie?.() || [];
  return sc.map((c) => c.split(";")[0]).join("; ");
}

async function login(username, password) {
  // 1. get csrf
  let res = await fetch(`${BASE}/api/auth/csrf`);
  let cookie = await getCookie(res);
  const { csrfToken } = await res.json();
  // 2. post credentials
  res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie },
    redirect: "manual",
    body: new URLSearchParams({ csrfToken, username, password, json: "true" }),
  });
  const more = await getCookie(res);
  cookie = [cookie, more].filter(Boolean).join("; ");
  // 3. verify session
  res = await fetch(`${BASE}/api/auth/session`, { headers: { cookie } });
  const session = await res.json();
  return { cookie, role: session?.user?.role };
}

const problems = [];

for (const [username, password] of ROLES) {
  const { cookie, role } = await login(username, password);
  if (!role) { problems.push(`LOGIN FAILED: ${username}`); continue; }
  const results = [];
  for (const path of GETS) {
    try {
      const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
      const status = res.status;
      if (status >= 500) {
        const body = await res.text();
        problems.push(`${role} ${path} → ${status}  ${body.slice(0, 120)}`);
        results.push(`  ✗ ${status} ${path}`);
      } else {
        results.push(`  · ${status} ${path}`);
      }
    } catch (e) {
      problems.push(`${role} ${path} → THREW ${e.message}`);
    }
  }
  const fails = results.filter((r) => r.includes("✗")).length;
  console.log(`\n[${role}] ${fails === 0 ? "all OK" : fails + " FAILURES"}`);
  if (fails) results.filter((r) => r.includes("✗")).forEach((r) => console.log(r));
}

console.log("\n========================================");
if (problems.length === 0) {
  console.log("✅ NO 500 ERRORS across all roles × all endpoints.");
} else {
  console.log(`❌ ${problems.length} problem(s):`);
  problems.forEach((p) => console.log("  " + p));
}
