import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { loadUserScope, roleOf, OVERSIGHT_ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";
import { getModule } from "@/lib/reports/registry";
import { accessibleModules, moduleMeta, runReport } from "@/lib/reports/engine";
import { TIME_PRESETS } from "@/lib/reports/timeRanges";

export const dynamic = "force-dynamic";

// Reports Center is oversight-only at the surface; per-module access is refined
// inside the engine (some modules are super-admin only) and data is geo-scoped
// to the caller's territory.
async function guard() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: Response.json({ message: "Unauthorized" }, { status: 401 }) };
  if (!OVERSIGHT_ROLES.includes(roleOf(session))) {
    return { error: Response.json({ message: "Forbidden" }, { status: 403 }) };
  }
  await loadUserScope(session, query);
  return { session };
}

// GET /api/reports                 → { modules, timePresets, users }
// GET /api/reports?module=calls    → full meta (columns, filters, groupBy) for one module
export async function GET(req) {
  const { session, error } = await guard();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const moduleKey = searchParams.get("module");

  if (moduleKey) {
    const module = getModule(moduleKey);
    if (!module) return Response.json({ message: "Unknown module" }, { status: 404 });
    // Enforce per-module access before revealing its meta.
    if (!accessibleModules(session).some((m) => m.key === moduleKey)) {
      return Response.json({ message: "Forbidden" }, { status: 403 });
    }
    return Response.json({ meta: await moduleMeta(module) });
  }

  const users = await query(
    "SELECT id, username, role FROM users WHERE is_active = 1 ORDER BY username"
  );
  return Response.json({
    modules: accessibleModules(session),
    timePresets: TIME_PRESETS,
    users,
  });
}

// POST /api/reports  { module, time, date_from, date_to, filters, geo, search,
//                      group_by, columns, sort, page, pageSize }
export async function POST(req) {
  const { session, error } = await guard();
  if (error) return error;

  let body;
  try { body = await req.json(); } catch { body = {}; }
  if (!body.module) return Response.json({ message: "module is required" }, { status: 400 });

  try {
    const result = await runReport({ moduleKey: body.module, session, body });
    if (result.error) return Response.json({ message: result.error }, { status: result.status || 400 });
    return Response.json(result);
  } catch (e) {
    console.error("[reports] query failed:", e);
    return Response.json({ message: "Report query failed" }, { status: 500 });
  }
}
