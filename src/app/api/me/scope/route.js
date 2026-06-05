import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { normalizeRole, ROLES, roleLabel } from "@/lib/permissions";
import { query } from "@/lib/db";

// Returns the current user's scope as a human label, e.g.
//   { level: "zone", name: "Raipur", role: "zone_admin", roleLabel: "Zone Admin" }
// State/Super → { level: "state", name: "Chhattisgarh" }
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const u = session.user;
    const role = normalizeRole(u.role);
    let level = "state", name = "Chhattisgarh", id = null;

    if (role === ROLES.ZONE_ADMIN && u.scope_zone_id) {
      level = "zone"; id = u.scope_zone_id;
      const [r] = await query("SELECT name FROM locations WHERE id = ?", [id]);
      name = r?.name || "(unset zone)";
    } else if ((role === ROLES.DISTRICT_ADMIN || role === ROLES.SUPERVISOR || role === ROLES.CALLER || role === ROLES.WORKER) && u.home_district_id) {
      level = "district"; id = u.home_district_id;
      const [r] = await query("SELECT name FROM locations WHERE id = ?", [id]);
      name = r?.name || "(unset district)";
    } else if (role === ROLES.ASSEMBLY_ADMIN && u.scope_assembly_id) {
      level = "assembly"; id = u.scope_assembly_id;
      const [r] = await query("SELECT name FROM locations WHERE id = ?", [id]);
      name = r?.name || "(unset assembly)";
    }

    return NextResponse.json({ level, name, id, role, roleLabel: roleLabel(role) });
  } catch (err) {
    console.error("me/scope error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
