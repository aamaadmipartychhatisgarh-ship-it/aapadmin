import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isTopAdmin } from "@/lib/permissions";
import { query, getPool } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import bcrypt from "bcryptjs";

export async function PUT(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isTopAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const data = await req.json();

    const sets = [];
    const vals = [];

    // Plain column updates.
    const allowed = ["role", "home_district_id", "is_active", "scope_zone_id", "scope_assembly_id"];
    for (const f of allowed) {
      if (f in data) {
        sets.push(`${f} = ?`);
        vals.push(data[f] === "" ? null : data[f]);
      }
    }

    // Username (validate + check uniqueness).
    if (typeof data.username === "string" && data.username.trim()) {
      const username = data.username.trim();
      const dupe = await query("SELECT id FROM users WHERE username = ? AND id <> ?", [username, id]);
      if (dupe.length) {
        return NextResponse.json({ message: "That username is already taken." }, { status: 409 });
      }
      sets.push("username = ?");
      vals.push(username);
    }

    // Password (optional — only if a non-empty value is provided).
    if (typeof data.password === "string" && data.password.length > 0) {
      if (data.password.length < 4) {
        return NextResponse.json({ message: "Password must be at least 4 characters." }, { status: 400 });
      }
      sets.push("password = ?");
      vals.push(bcrypt.hashSync(data.password, 10));
    }

    if (sets.length === 0) return NextResponse.json({ message: "No fields to update" }, { status: 400 });
    vals.push(id);
    await query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, vals);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("users PUT error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  let conn;
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isTopAdmin(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;

    // Self-delete protection.
    if (String(session.user.id) === String(id)) {
      return NextResponse.json({ message: "You can't delete your own account." }, { status: 400 });
    }

    const [victim] = await query("SELECT id, username, role FROM users WHERE id = ?", [id]);
    if (!victim) {
      return NextResponse.json({ message: "User not found." }, { status: 404 });
    }
    // System protection: never remove the last Super Admin (avoids locking
    // everyone out of the admin console).
    if (victim.role === "super_admin") {
      const [{ n }] = await query("SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin'");
      if (Number(n) <= 1) {
        return NextResponse.json({ message: "You can't delete the last Super Admin account." }, { status: 400 });
      }
    }

    // Discover every foreign key that references users.id, together with its
    // ON DELETE rule and whether the child column is nullable. We clean these
    // up EXPLICITLY inside a transaction so the delete works regardless of how
    // the FK was declared — production created several of these without an
    // ON DELETE clause (MariaDB defaults to RESTRICT), so any user with a
    // dependent row (calls, tasks, contacts, notifications, team membership…)
    // could not be deleted and the plain DELETE returned a 500.
    const refs = await query(
      `SELECT kcu.TABLE_NAME AS t, kcu.COLUMN_NAME AS c, col.IS_NULLABLE AS nullable, rc.DELETE_RULE AS rule
         FROM information_schema.KEY_COLUMN_USAGE kcu
         JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
           ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
         JOIN information_schema.COLUMNS col
           ON col.TABLE_SCHEMA = kcu.TABLE_SCHEMA AND col.TABLE_NAME = kcu.TABLE_NAME AND col.COLUMN_NAME = kcu.COLUMN_NAME
        WHERE kcu.TABLE_SCHEMA = DATABASE()
          AND kcu.REFERENCED_TABLE_NAME = 'users' AND kcu.REFERENCED_COLUMN_NAME = 'id'`
    );

    // One atomic transaction: detach/remove all dependents, then delete the
    // user. Any failure rolls the whole thing back — no half-deleted user.
    conn = await getPool().getConnection();
    const cleanup = [];
    try {
      await conn.beginTransaction();
      for (const r of refs) {
        // Table/column names come from information_schema (our own metadata),
        // not user input; strip stray backticks defensively before quoting.
        const tbl = `\`${String(r.t).replace(/`/g, "")}\``;
        const coln = `\`${String(r.c).replace(/`/g, "")}\``;
        // Honour the FK's designed behaviour where one is defined; for
        // RESTRICT / NO ACTION (production's broken case) fall back on the
        // column: nullable → detach (preserve the historical row), otherwise
        // the row belongs to the user → remove it.
        const setNull = r.rule === "SET NULL" || ((r.rule === "RESTRICT" || r.rule === "NO ACTION") && r.nullable === "YES");
        if (setNull) {
          const [res] = await conn.execute(`UPDATE ${tbl} SET ${coln} = NULL WHERE ${coln} = ?`, [id]);
          if (res.affectedRows) cleanup.push(`${r.t}.${r.c}: ${res.affectedRows} detached`);
        } else {
          const [res] = await conn.execute(`DELETE FROM ${tbl} WHERE ${coln} = ?`, [id]);
          if (res.affectedRows) cleanup.push(`${r.t}.${r.c}: ${res.affectedRows} removed`);
        }
      }
      await conn.execute("DELETE FROM users WHERE id = ?", [id]);
      await conn.commit();
    } catch (txErr) {
      try { await conn.rollback(); } catch { /* connection may be dead */ }
      throw txErr;
    }

    console.log(`[USER DELETE] id=${id} (${victim.username}) ok; dependents:`, cleanup.join("; ") || "none");
    // Best-effort audit AFTER the commit — never blocks or fails the delete.
    await logAudit(session, { action: "user.delete", entityType: "user", entityId: id, details: victim });
    return NextResponse.json({ ok: true, message: "User deleted successfully" });
  } catch (err) {
    // Log the real SQL error server-side; keep the client message generic/safe.
    console.error("users DELETE error:", err?.code || "", err?.message || err);
    return NextResponse.json({ message: "Unable to delete user." }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}
