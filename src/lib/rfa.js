import { query } from "@/lib/db";

// Review for Announce (RfA): a Supervisor-2 submits a Contact; the Super Admin
// reviews it. One table, one row per submission:
//   contact_id             → the Contact (never copied)
//   submitted_by_user_id   → the submitting Supervisor-2 (+ a name snapshot)
//   status                 → Pending → Correct | Incorrect (the Super Admin's verdict on the
//                            submitted contact information; Incorrect needs a reason)
//   active_contact_id      → equals contact_id while the review is Pending or Correct,
//                            NULL once Incorrect. UNIQUE, so the database itself
//                            refuses a second active review for a Contact (repeated
//                            clicks / concurrent requests); an Incorrect Contact frees
//                            the slot and may be resubmitted.
export const RFA_STATUSES = ["Pending", "Correct", "Incorrect"];
let ensured = false;
export async function ensureRfaSchema() {
  if (ensured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS contact_rfa_reviews (
       id INT AUTO_INCREMENT PRIMARY KEY,
       contact_id INT NOT NULL,
       submitted_by_user_id INT NULL,
       submitted_by_name VARCHAR(150) NULL,
       status VARCHAR(20) NOT NULL DEFAULT 'Pending',
       active_contact_id INT NULL,
       submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       reviewed_by_user_id INT NULL,
       reviewed_by_name VARCHAR(150) NULL,
       reviewed_at TIMESTAMP NULL DEFAULT NULL,
       review_remark TEXT NULL,
       UNIQUE KEY uq_rfa_active_contact (active_contact_id),
       KEY idx_rfa_contact (contact_id),
       KEY idx_rfa_status (status),
       KEY idx_rfa_submitter (submitted_by_user_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  // One-time rename of the earlier verdict labels (Approved → Correct, Rejected →
  // Incorrect). Same rows, same ids, same active_contact_id; a no-op once migrated.
  await query("UPDATE contact_rfa_reviews SET status = 'Correct' WHERE status = 'Approved'");
  await query("UPDATE contact_rfa_reviews SET status = 'Incorrect' WHERE status = 'Rejected'");
  ensured = true;
}

// SQL expression: the Contact's CURRENT review status (its latest review), or NULL.
export const RFA_STATUS_SQL = `(SELECT r.status FROM contact_rfa_reviews r WHERE r.contact_id = c.id ORDER BY r.id DESC LIMIT 1)`;

// The Contact List's RfA Status filter: ?rfa_status=pending|correct|incorrect -> the contact's CURRENT (latest) review has that status.
// A contact that was never submitted has no review, so it matches none of the three. Returns { where, params } for " AND ...", or
// { error } for any other value (nothing is guessed).
export const RFA_FILTER_VALUES = { pending: "Pending", correct: "Correct", incorrect: "Incorrect" };
export async function rfaStatusFilterClause(value, alias = "c") {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return { where: "", params: [] };
  const status = RFA_FILTER_VALUES[v];
  if (!status) return { error: "Unknown RfA status." };
  await ensureRfaSchema();
  return { where: ` AND (SELECT r.status FROM contact_rfa_reviews r WHERE r.contact_id = ${alias}.id ORDER BY r.id DESC LIMIT 1) = ?`, params: [status] };
}
