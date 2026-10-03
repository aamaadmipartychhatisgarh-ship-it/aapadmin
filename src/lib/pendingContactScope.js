import { isTopAdmin, isSupervisorRole, scopeFilterSync } from "@/lib/permissions";
import { supervisorScopeFilter } from "@/lib/supervisorScope";

// Territory scope for the Pending Approval queue, applied to BOTH the list (so a
// reviewer sees only pending contacts in their area) AND the approve/reject
// mutation (so they can only act on ids in their area — no IDOR). Top admins
// (super/state) see everything; a Supervisor uses the supervisor territory; every
// other tier (zone/district/assembly admin, portal member) uses its own geo scope.
export function pendingContactScope(session, alias = "c") {
  if (!session) return { where: " AND 1=0", params: [] };
  if (isTopAdmin(session)) return { where: "", params: [] };
  if (isSupervisorRole(session)) return supervisorScopeFilter(session.user, alias);
  return scopeFilterSync(session.user, alias);
}
