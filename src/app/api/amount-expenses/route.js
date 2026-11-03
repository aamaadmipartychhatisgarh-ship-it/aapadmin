import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { maGate, ensureMaSchema, maSummary, cleanEntry } from "@/lib/maAccess";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const denied = await maGate(session);
    if (denied) return denied;
    await ensureMaSchema();
    const entries = await query(`SELECT id, DATE_FORMAT(entry_date,'%Y-%m-%d') AS entry_date, entry_type, category, description, amount FROM ma_entries ORDER BY entry_date DESC, id DESC LIMIT 1000`);
    return NextResponse.json({ entries: entries.map((e) => ({ ...e, amount: Number(e.amount) })), summary: await maSummary() }, { headers: NO_STORE });
  } catch (e) {
    console.error("amount-expenses GET error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    const denied = await maGate(session);
    if (denied) return denied;
    const c = cleanEntry(await req.json().catch(() => ({})));
    if (c.error) return NextResponse.json({ message: c.error }, { status: 400 });
    await ensureMaSchema();
    const r = await query(`INSERT INTO ma_entries (entry_date, entry_type, category, description, amount, created_by) VALUES (?,?,?,?,?,?)`,
      [c.v.date, c.v.type, c.v.category, c.v.description, c.v.amount, session.user.id]);
    logAudit(session, { action: "ma.entry.create", entityType: "ma_entry", entityId: String(r.insertId), details: c.v }).catch(() => {});
    return NextResponse.json({ ok: true, id: r.insertId }, { status: 201, headers: NO_STORE });
  } catch (e) {
    console.error("amount-expenses POST error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
