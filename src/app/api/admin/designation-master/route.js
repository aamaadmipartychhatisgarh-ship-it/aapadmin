import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import {
  ensureWingSchema, listWings, getWing, listWingBases, syncWing, generatedForWing,
  designationHasAssignments, WING_LEVELS,
} from "@/lib/wingDesignations";

// Designation Master API (Administration). GET reads the wings + a wing's base
// roles and its auto-generated level designations; POST applies a mutation (by
// `action`) and re-syncs the affected wing so the generated designations in the
// shared `designations` table always match the master.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

async function guard() {
  const session = await getServerSession(authOptions);
  if (!(await pageAllowed(session, "master_data", session && isAdmin(session)))) {
    return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE }) };
  }
  return { session };
}

export async function GET(req) {
  try {
    const { error } = await guard();
    if (error) return error;
    await ensureWingSchema();
    const wingId = parseInt(new URL(req.url).searchParams.get("wing_id"), 10);
    const wings = await listWings();
    if (!Number.isInteger(wingId) || wingId <= 0) {
      return NextResponse.json({ wings, levels: WING_LEVELS }, { headers: NO_STORE });
    }
    const wing = await getWing(wingId);
    if (!wing) return NextResponse.json({ message: "Wing not found." }, { status: 404, headers: NO_STORE });
    const bases = wing.is_main ? [] : await listWingBases(wingId);
    const generated = await generatedForWing(wingId);
    return NextResponse.json({ wings, levels: WING_LEVELS, wing, bases, generated }, { headers: NO_STORE });
  } catch (err) {
    console.error("[designation-master] GET error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req) {
  try {
    const { error } = await guard();
    if (error) return error;
    await ensureWingSchema();
    const d = await req.json().catch(() => ({}));
    const action = String(d?.action || "");

    if (action === "add_wing") {
      const name = String(d.name || "").replace(/\s+/g, " ").trim();
      if (!name) return NextResponse.json({ message: "Wing name is required." }, { status: 400, headers: NO_STORE });
      const [{ n }] = await query(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM wings WHERE is_main = 0`);
      try {
        const res = await query(`INSERT INTO wings (name, sort_order, is_main) VALUES (?, ?, 0)`, [name, n]);
        return NextResponse.json({ ok: true, id: res.insertId }, { headers: NO_STORE });
      } catch (e) {
        if (e?.code === "ER_DUP_ENTRY") return NextResponse.json({ message: `"${name}" already exists.` }, { status: 409, headers: NO_STORE });
        throw e;
      }
    }

    // The remaining actions target a specific wing's base roles.
    const wingId = parseInt(d.wing_id, 10) || (await baseWing(d.base_id));
    if (action === "add_base") {
      const wing = await getWing(parseInt(d.wing_id, 10));
      if (!wing) return NextResponse.json({ message: "Select a valid wing." }, { status: 400, headers: NO_STORE });
      if (wing.is_main) return NextResponse.json({ message: "Main Organisation designations are fixed and cannot be generated per level." }, { status: 400, headers: NO_STORE });
      const baseName = String(d.base_name || "").replace(/\s+/g, " ").trim();
      if (!baseName) return NextResponse.json({ message: "Designation name is required." }, { status: 400, headers: NO_STORE });
      const [{ n }] = await query(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM wing_designations WHERE wing_id = ?`, [wing.id]);
      try {
        await query(`INSERT INTO wing_designations (wing_id, base_name, sort_order) VALUES (?, ?, ?)`, [wing.id, baseName, n]);
      } catch (e) {
        if (e?.code === "ER_DUP_ENTRY") return NextResponse.json({ message: `"${baseName}" already exists in this wing.` }, { status: 409, headers: NO_STORE });
        throw e;
      }
      await syncWing(wing.id);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    if (action === "edit_base") {
      const baseId = parseInt(d.base_id, 10);
      const baseName = String(d.base_name || "").replace(/\s+/g, " ").trim();
      if (!baseId || !baseName) return NextResponse.json({ message: "A valid designation and name are required." }, { status: 400, headers: NO_STORE });
      try {
        await query(`UPDATE wing_designations SET base_name = ? WHERE id = ?`, [baseName, baseId]);
      } catch (e) {
        if (e?.code === "ER_DUP_ENTRY") return NextResponse.json({ message: `"${baseName}" already exists in this wing.` }, { status: 409, headers: NO_STORE });
        throw e;
      }
      if (wingId) await syncWing(wingId);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    if (action === "toggle_base") {
      const baseId = parseInt(d.base_id, 10);
      if (!baseId) return NextResponse.json({ message: "Invalid designation." }, { status: 400, headers: NO_STORE });
      await query(`UPDATE wing_designations SET enabled = ? WHERE id = ?`, [d.enabled ? 1 : 0, baseId]);
      if (wingId) await syncWing(wingId);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    if (action === "delete_base") {
      const baseId = parseInt(d.base_id, 10);
      if (!baseId) return NextResponse.json({ message: "Invalid designation." }, { status: 400, headers: NO_STORE });
      // Report whether any generated level of this base is currently assigned — the
      // caller is warned, and the generated rows are DISABLED (never deleted) by the
      // sync, so no assignment is lost.
      const gens = await query(`SELECT id FROM designations WHERE wing_base_id = ?`, [baseId]);
      let assigned = false;
      for (const g of gens) { if (await designationHasAssignments(g.id)) { assigned = true; break; } }
      await query(`DELETE FROM wing_designations WHERE id = ?`, [baseId]);
      if (wingId) await syncWing(wingId);
      return NextResponse.json({ ok: true, had_assignments: assigned }, { headers: NO_STORE });
    }

    if (action === "reorder") {
      const wId = parseInt(d.wing_id, 10);
      const order = Array.isArray(d.order) ? d.order.map((x) => parseInt(x, 10)).filter(Boolean) : [];
      if (!wId || !order.length) return NextResponse.json({ message: "Invalid reorder request." }, { status: 400, headers: NO_STORE });
      for (let i = 0; i < order.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        await query(`UPDATE wing_designations SET sort_order = ? WHERE id = ? AND wing_id = ?`, [i, order[i], wId]);
      }
      await syncWing(wId);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    return NextResponse.json({ message: "Unknown action." }, { status: 400, headers: NO_STORE });
  } catch (err) {
    console.error("[designation-master] POST error:", err?.code || "", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

// Resolve which wing a base row belongs to (for actions that pass only base_id).
async function baseWing(baseId) {
  const id = parseInt(baseId, 10);
  if (!id) return null;
  const [row] = await query(`SELECT wing_id FROM wing_designations WHERE id = ?`, [id]);
  return row?.wing_id || null;
}
