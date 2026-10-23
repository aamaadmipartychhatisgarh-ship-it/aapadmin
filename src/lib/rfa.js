import { query } from "@/lib/db";

// Review for Announce (RfA): a Supervisor-2 submits a Contact; the Super Admin
// reviews it. One table, one row per submission:
//   contact_id             → the Contact (never copied)
//   submitted_by_user_id   → the submitting Supervisor-2 (+ a name snapshot)
//   status                 → Pending → Approved | Rejected
//   active_contact_id      → equals contact_id while the review is Pending or
//                            Approved, NULL once Rejected. UNIQUE, so the database
//                            itself refuses a second active review for a Contact
//                            (repeated clicks / concurrent requests); a Rejected
//                            Contact frees the slot and may be resubmitted.
export const RFA_STATUSES = ["Pending", "Approved", "Rejected"];
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
  ensured = true;
}

// SQL expression: the Contact's CURRENT review status (its latest review), or NULL.
export const RFA_STATUS_SQL = `(SELECT r.status FROM contact_rfa_reviews r WHERE r.contact_id = c.id ORDER BY r.id DESC LIMIT 1)`;
