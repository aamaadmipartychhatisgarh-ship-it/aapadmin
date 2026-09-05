// Date-wise task grouping — STRICTLY by task CREATION date, never the due date.
//
// The Task page groups: Created Date → Assignee → Tasks. The due date
// (task.deadline) is display-only and has ZERO influence on grouping. A task
// created on 05 Sep stays under 05 Sep regardless of its deadline — whether the
// deadline is later changed, removed, or the task is edited on another day.
//
// Standalone (no React) so the rule is unit-testable — see taskGrouping.test.mjs.

const APP_TZ = "Asia/Kolkata";

// Stable YYYY-MM-DD key in the app timezone, so a task created just before/after
// midnight groups by the same IST calendar day the rest of the Tasks screen
// uses. created_at is stored UTC, so a naive slice would be off by up to 5h30m
// near midnight — this converts properly. en-CA formats as YYYY-MM-DD.
export function istDayKey(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// Group tasks: Created Date (newest first, undated last) → Assignee (by real
// user/team id, never display name, so same-named users never merge; Unassigned
// is its own group) → tasks (incoming order preserved).
//
// Grouping key = task.created_at ONLY, falling back to task.assigned_at (both
// stamped at creation in this app) — NEVER task.deadline. Returns the exact
// shape the Tasks table render consumes: { key, label, total, users:[{ key,
// name, isTeam, unassigned, tasks }] }. `formatDate` (IST DD/MM/YYYY, the app's
// single date-format source of truth) is injected so this stays React/UI-free.
export function groupTasksByCreatedThenUser(tasks, formatDate) {
  const byDate = new Map();
  for (const t of tasks || []) {
    const created = t.created_at || t.assigned_at || null; // creation stamp, not deadline
    const dk = istDayKey(created) || "none";
    if (!byDate.has(dk)) byDate.set(dk, []);
    byDate.get(dk).push(t);
  }
  return [...byDate.keys()]
    .sort((a, b) => (a === "none" ? 1 : b === "none" ? -1 : (a < b ? 1 : -1))) // newest first
    .map((dk) => {
      const byUser = new Map();
      for (const t of byDate.get(dk)) {
        const uKey = t.assigned_to_user_id ? `u:${t.assigned_to_user_id}`
          : t.assigned_to_team_id ? `t:${t.assigned_to_team_id}` : "unassigned";
        if (!byUser.has(uKey)) {
          byUser.set(uKey, {
            key: uKey,
            name: t.assignee_name || t.team_name || "Unassigned",
            isTeam: !t.assigned_to_user_id && !!t.assigned_to_team_id,
            unassigned: !t.assigned_to_user_id && !t.assigned_to_team_id,
            tasks: [],
          });
        }
        byUser.get(uKey).tasks.push(t);
      }
      return {
        key: dk,
        label: dk === "none" ? "No creation date" : (formatDate ? formatDate(dk) : dk),
        total: byDate.get(dk).length,
        users: [...byUser.values()],
      };
    });
}
