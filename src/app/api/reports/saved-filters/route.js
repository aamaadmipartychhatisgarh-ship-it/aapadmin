import { NextResponse as Response } from "next/server";
import { query } from "@/lib/db";
import { reportsGuard as guard } from "@/lib/reports/guard";

export const dynamic = "force-dynamic";

// GET /api/reports/saved-filters?module=workers  → this user's saved views for that module
export async function GET(req) {
  const { session, error } = await guard();
  if (error) return error;
  const { searchParams } = new URL(req.url);
  const moduleKey = searchParams.get("module");
  if (!moduleKey) return Response.json({ message: "module is required" }, { status: 400 });

  const rows = await query(
    "SELECT id, name, config, created_at FROM saved_reports WHERE user_id = ? AND module_key = ? ORDER BY name",
    [session.user.id, moduleKey]
  );
  return Response.json({
    saved: rows.map((r) => ({ id: r.id, name: r.name, config: JSON.parse(r.config), created_at: r.created_at })),
  });
}

// POST /api/reports/saved-filters  { module, name, config }
// Saving under a name that already exists for this user+module overwrites it.
export async function POST(req) {
  const { session, error } = await guard();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const moduleKey = String(body.module || "").trim();
  const name = String(body.name || "").trim();
  if (!moduleKey || !name) return Response.json({ message: "module and name are required" }, { status: 400 });
  if (name.length > 120) return Response.json({ message: "Name is too long (120 chars max)." }, { status: 400 });

  await query(
    `INSERT INTO saved_reports (user_id, module_key, name, config) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE config = VALUES(config)`,
    [session.user.id, moduleKey, name, JSON.stringify(body.config || {})]
  );
  const [row] = await query(
    "SELECT id, name, config, created_at FROM saved_reports WHERE user_id = ? AND module_key = ? AND name = ?",
    [session.user.id, moduleKey, name]
  );
  return Response.json({ saved: { id: row.id, name: row.name, config: JSON.parse(row.config), created_at: row.created_at } }, { status: 201 });
}
