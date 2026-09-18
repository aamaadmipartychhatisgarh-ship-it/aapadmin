import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import { blockBelongsToAssembly, isAssembly, normalizeBlockName, ensureBlockColumns } from "@/lib/politicalLocation";

// PATCH /api/assemblies/{id}/blocks/{blockId} — edit a Block (rename, Hindi name,
// status) or MOVE it to another assembly. The block must currently belong to {id}
// (validated), and a move re-parents it to a real assembly (§7/§12). A duplicate
// name within the destination assembly is rejected (§14).
export const dynamic = "force-dynamic";

export async function PATCH(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    await ensureBlockColumns();
    const { id, blockId } = await params;
    if (!(await blockBelongsToAssembly(blockId, id))) {
      return NextResponse.json({ message: "That Block does not belong to this Assembly." }, { status: 404 });
    }
    const d = await req.json().catch(() => ({}));
    const sets = [], vals = [];
    let destAssembly = Number(id);
    if (d.assembly_id !== undefined && Number(d.assembly_id) !== Number(id)) {
      const dest = Number(d.assembly_id);
      if (!(await isAssembly(dest))) return NextResponse.json({ message: "Invalid destination Assembly." }, { status: 400 });
      destAssembly = dest;
      sets.push("parent_id = ?"); vals.push(dest);
    }
    if (d.name !== undefined) {
      const name = String(d.name || "").replace(/\s+/g, " ").trim();
      if (!name) return NextResponse.json({ message: "Block name is required." }, { status: 400 });
      const siblings = await query(`SELECT id, name FROM locations WHERE type = 'ward' AND parent_id = ? AND id <> ?`, [destAssembly, Number(blockId)]);
      if (siblings.some((r) => normalizeBlockName(r.name) === normalizeBlockName(name))) {
        return NextResponse.json({ message: `"${name}" already exists as a Block in that Assembly.` }, { status: 409 });
      }
      sets.push("name = ?"); vals.push(name.slice(0, 190));
    }
    if (d.name_hi !== undefined) { sets.push("name_hi = ?"); vals.push(String(d.name_hi || "").replace(/\s+/g, " ").trim().slice(0, 190) || null); }
    if (d.status !== undefined) { sets.push("status = ?"); vals.push(d.status === "inactive" ? "inactive" : "active"); }
    if (!sets.length) return NextResponse.json({ message: "Nothing to update." }, { status: 400 });
    vals.push(Number(blockId));
    await query(`UPDATE locations SET ${sets.join(", ")} WHERE id = ? AND type = 'ward'`, vals);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("block PATCH error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/assemblies/{id}/blocks/{blockId} — remove a Block (must belong to {id}).
export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { id, blockId } = await params;
    if (!(await blockBelongsToAssembly(blockId, id))) {
      return NextResponse.json({ message: "That Block does not belong to this Assembly." }, { status: 404 });
    }
    await query(`DELETE FROM locations WHERE id = ? AND type = 'ward'`, [Number(blockId)]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("block DELETE error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
