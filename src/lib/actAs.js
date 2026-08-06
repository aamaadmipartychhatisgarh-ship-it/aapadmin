import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { normalizeRole, ROLES } from "@/lib/permissions";

// Cookie carrying the caller a Super Admin picked in the Quick Dashboard Switch
// submenu. Set client-side by src/lib/dashboardView.js; keep the name in sync.
export const VIEW_AS_COOKIE = "aap_view_as_user";

// Resolve which user the workspace endpoints should act as. When the real,
// signed-in user is a Super Admin who has selected a specific caller, act as
// that caller (view their queue, claim/log on their behalf) while the session
// itself stays Super Admin. This is ONLY ever honored for a genuine Super
// Admin naming a genuine, active caller — it never grants privilege to anyone
// else, and any other user always acts as themselves.
export async function resolveActingUserId(session) {
  const realId = session?.user?.id;
  if (!realId || normalizeRole(session.user.role) !== ROLES.SUPER_ADMIN) {
    return { userId: realId, impersonating: false };
  }
  let raw = null;
  try { raw = (await cookies()).get(VIEW_AS_COOKIE)?.value; } catch { /* no cookie store */ }
  const targetId = parseInt(raw, 10);
  if (!targetId || String(targetId) === String(realId)) {
    return { userId: realId, impersonating: false };
  }
  const rows = await query("SELECT id, role FROM users WHERE id = ? AND is_active = 1", [targetId]);
  if (!rows[0] || normalizeRole(rows[0].role) !== ROLES.CALLER) {
    return { userId: realId, impersonating: false };
  }
  return { userId: targetId, impersonating: true };
}
