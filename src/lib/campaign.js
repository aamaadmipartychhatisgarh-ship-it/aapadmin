import { query } from "@/lib/db";
import { ensureMembershipSchema } from "@/lib/membershipSchema";
import { logAudit } from "@/lib/audit";

// Campaign period + 3-month access (password) cycle management for the dashboard.
//
// IMPORTANT (§24): rotating to a new campaign period issues a NEW password/access
// cycle but NEVER changes a worker's User ID (worker_code) — those are permanent.
// The actual per-worker password change is the worker app's responsibility; here
// the Super Admin records/monitors the cycle and the dashboard reports it.

function daysBetween(a, b) {
  const ms = new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}

// The number of workers a cycle affects = currently active workers.
async function affectedWorkers() {
  try {
    const [r] = await query(`SELECT COUNT(*) AS c FROM workers WHERE status = 'active'`);
    return Number(r?.c) || 0;
  } catch { return 0; }
}

export async function getCurrentCampaign() {
  await ensureMembershipSchema();
  const today = new Date().toISOString().slice(0, 10);
  // Active = status 'active' and covering today, most recent first.
  const [active] = await query(
    `SELECT * FROM membership_campaigns
      WHERE status = 'active'
      ORDER BY (start_date <= ? AND end_date >= ?) DESC, end_date DESC
      LIMIT 1`, [today, today]
  );
  const [prev] = await query(
    `SELECT * FROM membership_campaigns WHERE end_date < ? ORDER BY end_date DESC LIMIT 1`, [today]
  );
  const [next] = await query(
    `SELECT * FROM membership_campaigns WHERE start_date > ? ORDER BY start_date ASC LIMIT 1`, [today]
  );
  const workers = await affectedWorkers();

  if (!active) {
    return { configured: false, current: null, previous: prev || null, next: next || null, workersAffected: workers };
  }
  const daysRemaining = Math.max(0, daysBetween(today, active.end_date));
  const cycleDaysRemaining = active.password_cycle_expiry ? Math.max(0, daysBetween(today, active.password_cycle_expiry)) : null;
  const cycleExpired = active.password_cycle_expiry ? new Date(active.password_cycle_expiry) < new Date(today) : false;
  return {
    configured: true,
    current: {
      ...active,
      days_remaining: daysRemaining,
      password_cycle_days_remaining: cycleDaysRemaining,
      password_cycle_expired: cycleExpired,
    },
    previous: prev || null,
    next: next || null,
    workersAffected: workers,
  };
}

export async function listCampaigns() {
  await ensureMembershipSchema();
  return query(`SELECT * FROM membership_campaigns ORDER BY start_date DESC`);
}

// Add 3 months to a 'YYYY-MM-DD' date.
function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// Create a new campaign period. If end_date is omitted it defaults to a 3-month
// window from start. The password cycle defaults to the same window.
export async function createCampaign(session, data, { rotate = false } = {}) {
  await ensureMembershipSchema();
  const name = String(data.name || "").trim();
  const start = String(data.start_date || "").slice(0, 10);
  if (!name) throw new Error("Campaign name is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error("A valid start date is required.");
  const end = (data.end_date && /^\d{4}-\d{2}-\d{2}$/.test(data.end_date)) ? data.end_date : addMonths(start, 3);
  const cycleStart = (data.password_cycle_start && /^\d{4}-\d{2}-\d{2}$/.test(data.password_cycle_start)) ? data.password_cycle_start : start;
  const cycleExpiry = (data.password_cycle_expiry && /^\d{4}-\d{2}-\d{2}$/.test(data.password_cycle_expiry)) ? data.password_cycle_expiry : end;

  // Rotating: close every currently-active campaign first so exactly one is active.
  if (rotate) {
    await query(`UPDATE membership_campaigns SET status = 'closed' WHERE status = 'active'`);
  }
  const res = await query(
    `INSERT INTO membership_campaigns
       (name, start_date, end_date, status, password_cycle_start, password_cycle_expiry, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [name, start, end, "active", cycleStart, cycleExpiry, session?.user?.id || null]
  );
  const [row] = await query(`SELECT * FROM membership_campaigns WHERE id = ?`, [res.insertId]);
  const workers = await affectedWorkers();
  logAudit(session, {
    action: rotate ? "membership_campaign_rotate" : "membership_campaign_create",
    entityType: "membership_campaign",
    entityId: res.insertId,
    details: { name, start, end, cycleStart, cycleExpiry, workersAffected: workers, note: rotate ? "New password cycle issued; worker User IDs unchanged." : undefined },
  });
  return row;
}
