import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { maGate, ensureMaSchema, cleanEntry } from "@/lib/maAccess";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const idOf = async (params) => { const id = Number((await params).id); return Number.isInteger(id) && id > 0 ? id : null; };

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    const denied = await maGate(session);
    if (denied) return denied;
    const id = await idOf(params);
    if (!id) return NextResponse.json({ message: "Invalid entry." }, { status: 400 });
    const c = cleanEntry(await req.json().catch(() => ({})));
    if (c.error) return NextResponse.json({ message: c.error }, { status: 400 });
    await ensureMaSchema();
    const r = await query(`UPDATE ma_entries SET entry_date=?, entry_type=?, category=?, description=?, amount=? WHERE id=?`, [c.v.date, c.v.type, c.v.category, c.v.description, c.v.amount, id]);
    if (!r.affectedRows) return NextResponse.json({ message: "Entry not found." }, { status: 404 });
    logAudit(session, { action: "ma.entry.update", entityType: "ma_entry", entityId: String(id), details: c.v }).catch(() => {});
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    console.error("amount-expenses PUT error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    const denied = await maGate(session);
    if (denied) return denied;
    const id = await idOf(params);
    if (!id) return NextResponse.json({ message: "Invalid entry." }, { status: 400 });
    await ensureMaSchema();
    const r = await query(`DELETE FROM ma_entries WHERE id=?`, [id]);
    if (!r.affectedRows) return NextResponse.json({ message: "Entry not found." }, { status: 404 });
    logAudit(session, { action: "ma.entry.delete", entityType: "ma_entry", entityId: String(id) }).catch(() => {});
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    console.error("amount-expenses DELETE error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
