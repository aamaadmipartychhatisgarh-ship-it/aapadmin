import { query } from "@/lib/db";

// VACANCY REMINDER persistence. Vacancies themselves are ALWAYS computed live from
// the organizational data (never stored), so a filled designation simply stops
// appearing. What we DO persist is the reminder state per responsible person:
//   • vacancy_reminders     — current status/attempts/last-sent, one row per group
//   • vacancy_reminder_log  — an append-only audit trail (kept even after the
//                             vacancy is filled, for reporting/audit).
//
// A "group" is one responsible person (group_key = "resp:<contact_id>"), so all of
// that person's pending vacancies share a single reminder record and go out in one
// WhatsApp message.

let ensured = false;
export async function ensureVacancyReminderSchema() {
  if (ensured) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS vacancy_reminders (
         id INT AUTO_INCREMENT PRIMARY KEY,
         group_key VARCHAR(191) NOT NULL,
         responsible_contact_id INT NULL,
         responsible_name VARCHAR(191) NULL,
         responsible_mobile VARCHAR(30) NULL,
         status ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
         attempts INT NOT NULL DEFAULT 0,
         last_reminder_at DATETIME NULL,
         last_message TEXT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uq_group (group_key),
         KEY idx_status (status),
         KEY idx_contact (responsible_contact_id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    await query(
      `CREATE TABLE IF NOT EXISTS vacancy_reminder_log (
         id INT AUTO_INCREMENT PRIMARY KEY,
         group_key VARCHAR(191) NOT NULL,
         responsible_contact_id INT NULL,
         responsible_name VARCHAR(191) NULL,
         responsible_mobile VARCHAR(30) NULL,
         status ENUM('sent','failed') NOT NULL,
         message TEXT NULL,
         sent_by INT NULL,
         sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         KEY idx_group (group_key),
         KEY idx_sent_at (sent_at)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    ensured = true;
  } catch (e) {
    console.error("[vacancy] ensure reminder schema:", e?.message || e);
  }
}

// Current reminder state for a set of group keys → Map(group_key → row). Missing
// keys (never reminded) are simply absent and default to "pending" at the caller.
export async function getReminderStates(groupKeys) {
  const map = new Map();
  const keys = [...new Set((groupKeys || []).filter(Boolean))];
  if (!keys.length) return map;
  await ensureVacancyReminderSchema();
  const placeholders = keys.map(() => "?").join(",");
  const rows = await query(
    `SELECT group_key, responsible_contact_id, responsible_name, responsible_mobile,
            status, attempts, last_reminder_at
       FROM vacancy_reminders WHERE group_key IN (${placeholders})`,
    keys
  );
  for (const r of rows) map.set(r.group_key, r);
  return map;
}

// Record the outcome of a reminder attempt: upsert the current state and append an
// audit-log row. `status` is 'sent' or 'failed'. attempts is only bumped on a real
// attempt (i.e. every call here), and last_reminder_at reflects the latest attempt.
export async function recordReminder({ group_key, responsible_contact_id, responsible_name, responsible_mobile, status, message, sent_by }) {
  await ensureVacancyReminderSchema();
  await query(
    `INSERT INTO vacancy_reminders
       (group_key, responsible_contact_id, responsible_name, responsible_mobile, status, attempts, last_reminder_at, last_message)
     VALUES (?, ?, ?, ?, ?, 1, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       responsible_contact_id = VALUES(responsible_contact_id),
       responsible_name = VALUES(responsible_name),
       responsible_mobile = VALUES(responsible_mobile),
       status = VALUES(status),
       attempts = attempts + 1,
       last_reminder_at = NOW(),
       last_message = VALUES(last_message)`,
    [group_key, responsible_contact_id ?? null, responsible_name ?? null, responsible_mobile ?? null, status, message ?? null]
  );
  await query(
    `INSERT INTO vacancy_reminder_log
       (group_key, responsible_contact_id, responsible_name, responsible_mobile, status, message, sent_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [group_key, responsible_contact_id ?? null, responsible_name ?? null, responsible_mobile ?? null, status, message ?? null, sent_by ?? null]
  );
  const [row] = await query(`SELECT * FROM vacancy_reminders WHERE group_key = ?`, [group_key]);
  return row || null;
}

// Reminder history for a group (audit/report), newest first.
export async function reminderHistory(groupKey, limit = 50) {
  await ensureVacancyReminderSchema();
  return query(
    `SELECT id, status, message, responsible_mobile, sent_by, sent_at
       FROM vacancy_reminder_log WHERE group_key = ? ORDER BY sent_at DESC LIMIT ?`,
    [groupKey, Math.min(200, Math.max(1, limit))]
  );
}

// Normalize an Indian mobile for wa.me (91XXXXXXXXXX). Returns null if it can't be
// made into a plausible number, so callers can mark the reminder Failed instead of
// generating a broken link.
export function toWhatsAppNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return null;
}

// Build the grouped reminder message from a responsible person's vacant
// designations (each "Designation — Location"). Matches the required wording.
export function buildReminderMessage(vacancies) {
  const lines = vacancies.map((v) => `— ${v.designation_name}${v.location_name ? ` (${v.location_name})` : ""}`);
  return (
    "Your organizational team has the following vacant positions:\n\n" +
    lines.join("\n") +
    "\n\nPlease fill these vacant positions at the earliest and update the organizational details."
  );
}
