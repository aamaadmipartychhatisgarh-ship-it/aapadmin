import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/appSettings";
import { normalizeRole, ROLES, isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";

// "MA" = the Admin's master Show/Hide switch for the Amount & Expenses module.
// ONE persisted flag (app_settings.ma_enabled) drives the page, the sidebar entry, the Dashboard card and
// every API. Turning it off only HIDES the module: nothing in ma_entries is ever touched by the switch.
export const MA_PAGE_KEY = "amount_expenses";
const KEY = "ma_enabled";

export async function isMaEnabled() {
  try { return (await getSetting(KEY)) === "1"; } catch { return false; }   // never set / unreadable => hidden
}
export async function setMaEnabled(on) { await setSetting(KEY, on ? "1" : "0"); }

// Only a Super Admin may flip the switch.
export function canManageMa(session) {
  return !!session?.user && normalizeRole(session.user.role) === ROLES.SUPER_ADMIN;
}

// THE gate every Amount & Expenses API starts with. Returns a NextResponse to send back, or null when allowed.
// Hidden => 404 for everyone (as if the module did not exist); otherwise the user needs the page.
export async function maGate(session) {
  if (!session?.user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!(await isMaEnabled())) return NextResponse.json({ message: "Not found" }, { status: 404 });
  if (!(await pageAllowed(session, MA_PAGE_KEY, isAdmin(session)))) return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  return null;
}

let ensured = null;
export function ensureMaSchema() {
  if (!ensured) {
    ensured = query(
      `CREATE TABLE IF NOT EXISTS ma_entries (
         id INT AUTO_INCREMENT PRIMARY KEY,
         entry_date DATE NOT NULL,
         entry_type ENUM('amount','expense') NOT NULL,
         category VARCHAR(120) NULL,
         description VARCHAR(500) NULL,
         amount DECIMAL(14,2) NOT NULL,
         created_by INT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         KEY idx_ma_date (entry_date)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ).catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

export async function maSummary() {
  await ensureMaSchema();
  const [t] = await query(
    `SELECT COALESCE(SUM(CASE WHEN entry_type='amount' THEN amount END),0) AS total_amount,
            COALESCE(SUM(CASE WHEN entry_type='expense' THEN amount END),0) AS total_expense,
            COALESCE(SUM(CASE WHEN entry_type='amount' AND entry_date >= DATE_FORMAT(CURDATE(),'%Y-%m-01') THEN amount END),0) AS month_amount,
            COALESCE(SUM(CASE WHEN entry_type='expense' AND entry_date >= DATE_FORMAT(CURDATE(),'%Y-%m-01') THEN amount END),0) AS month_expense,
            COUNT(*) AS entries
       FROM ma_entries`
  );
  const n = (v) => Number(v) || 0;
  return { total_amount: n(t.total_amount), total_expense: n(t.total_expense), balance: n(t.total_amount) - n(t.total_expense),
           month_amount: n(t.month_amount), month_expense: n(t.month_expense), entries: n(t.entries) };
}

export function cleanEntry(d) {
  const type = d?.entry_type === "expense" ? "expense" : d?.entry_type === "amount" ? "amount" : null;
  const amount = Number(d?.amount);
  const date = String(d?.entry_date || "").slice(0, 10);
  if (!type) return { error: "Type must be Amount or Expense." };
  if (!Number.isFinite(amount) || amount <= 0 || amount > 9999999999) return { error: "Enter a valid amount greater than 0." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime())) return { error: "Enter a valid date." };
  return { v: { type, amount: Math.round(amount * 100) / 100, date, category: String(d?.category || "").trim().slice(0, 120) || null, description: String(d?.description || "").trim().slice(0, 500) || null } };
}

