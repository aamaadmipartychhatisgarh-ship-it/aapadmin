// Wrong Number data-isolation fix: record who/when/why a contact was marked,
// and who/when restored it — so the Wrong Numbers module has real detail to
// show and the audit trail is complete. Additive, nullable, idempotent.
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const c = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});
const has = async (col) => {
  const [r] = await c.query(
    `SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contacts' AND COLUMN_NAME=?`, [col]);
  return Number(r[0].n) > 0;
};
try {
  if (!(await has("wrong_number_reason"))) {
    await c.query(
      "ALTER TABLE contacts ADD COLUMN wrong_number_reason ENUM('not_in_service','invalid_number','belongs_to_someone_else','number_changed','other') NULL AFTER is_wrong_number"
    );
  }
  if (!(await has("wrong_number_notes"))) await c.query("ALTER TABLE contacts ADD COLUMN wrong_number_notes VARCHAR(500) NULL AFTER wrong_number_reason");
  if (!(await has("wrong_number_at"))) await c.query("ALTER TABLE contacts ADD COLUMN wrong_number_at TIMESTAMP NULL AFTER wrong_number_notes");
  if (!(await has("wrong_number_by"))) await c.query("ALTER TABLE contacts ADD COLUMN wrong_number_by INT NULL AFTER wrong_number_at");
  if (!(await has("wrong_number_call_id"))) await c.query("ALTER TABLE contacts ADD COLUMN wrong_number_call_id INT NULL AFTER wrong_number_by");
  if (!(await has("restored_at"))) await c.query("ALTER TABLE contacts ADD COLUMN restored_at TIMESTAMP NULL AFTER wrong_number_call_id");
  if (!(await has("restored_by"))) await c.query("ALTER TABLE contacts ADD COLUMN restored_by INT NULL AFTER restored_at");

  const [fkCheck] = await c.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contacts' AND COLUMN_NAME='wrong_number_by' AND REFERENCED_TABLE_NAME IS NOT NULL`
  );
  if (fkCheck.length === 0) {
    await c.query("ALTER TABLE contacts ADD CONSTRAINT fk_contacts_wrong_number_by FOREIGN KEY (wrong_number_by) REFERENCES users(id) ON DELETE SET NULL");
    await c.query("ALTER TABLE contacts ADD CONSTRAINT fk_contacts_restored_by FOREIGN KEY (restored_by) REFERENCES users(id) ON DELETE SET NULL");
    await c.query("ALTER TABLE contacts ADD CONSTRAINT fk_contacts_wrong_number_call FOREIGN KEY (wrong_number_call_id) REFERENCES calls(id) ON DELETE SET NULL");
  }
  console.log("Wrong-number detail columns ready.");
} finally {
  await c.end();
}
