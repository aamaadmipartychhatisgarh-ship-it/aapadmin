import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ONE-TIME CLEANUP — remove every row of the Designation Master (`designations`:
// names, ranks, levels, wings) so new designations can be created from scratch.
//
//   node scripts/clear-designations.mjs            → DRY RUN (default): changes nothing,
//                                                     prints every relationship + row count
//   node scripts/clear-designations.mjs --apply    → backs up, then clears (one transaction)
//   add --minimal to leave every link table alone (see below)
//
// Handling of everything that points at a designation (found dynamically from
// information_schema, so nothing is missed):
//   • contacts / calls / complaints / reg_people .designation_id (nullable) → set NULL.
//     The contact, call, worker or member row itself is KEPT.
//   • contact_designations (a contact's held designations) and wing_designations
//     (wing ↔ designation templates) → rows deleted; they are meaningless without
//     their designation. Contacts are not touched.
//   • designation_assignments / designation_approvals(+history) / designation_appointments
//     (Designation Chain + Approval data) → LEFT UNTOUCHED and only reported.
// Call Statuses, Caste/Polling/Party Masters, users and every other table are never
// touched. The table is emptied with DELETE (not TRUNCATE / DROP) and the
// AUTO_INCREMENT counter is left alone. A mysqldump backup is mandatory with --apply.

const APPLY = process.argv.includes('--apply');
// --minimal: touch NOTHING but the designations table itself (plus contacts.designation_id,
// which the app's own Delete button also clears, and calls.designation_id which the
// database nulls by its own ON DELETE SET NULL rule). Link tables are left as they are.
const MINIMAL = process.argv.includes('--minimal');
const REPORT_ONLY = new Set(['designation_assignments', 'designation_approvals', 'designation_approval_history', 'designation_appointments']);
const DELETE_ROWS = new Set(['contact_designations', 'wing_designations']);

async function run() {
  const cfg = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aapadmin',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  };
  const conn = await mysql.createConnection(cfg);
  try {
    const [[{ n: total }]] = await conn.query('SELECT COUNT(*) n FROM designations');
    console.log(`Database ${cfg.database}: ${total} designation row(s).`);

    const [cols] = await conn.query(
      `SELECT TABLE_NAME t, COLUMN_NAME c, IS_NULLABLE nullable FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'designation_id' AND TABLE_NAME <> 'designations'`);
    const plan = [];
    for (const { t, c, nullable } of cols) {
      const [[{ n }]] = await conn.query(`SELECT COUNT(*) n FROM \`${t}\` WHERE \`${c}\` IS NOT NULL`);
      let action = 'set NULL (row kept)';
      if (MINIMAL && t !== 'contacts') action = 'LEFT UNTOUCHED (minimal mode)';
      else if (REPORT_ONLY.has(t)) action = 'LEFT UNTOUCHED (reported only)';
      else if (DELETE_ROWS.has(t)) action = 'delete link rows';
      else if (nullable !== 'YES') action = 'NOT NULLABLE — will ABORT';
      plan.push({ t, c, n, action });
    }
    const [[{ n: wd }]] = await conn.query("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wing_designations'");
    if (wd && !MINIMAL) {
      const [[{ n }]] = await conn.query('SELECT COUNT(*) n FROM wing_designations');
      plan.push({ t: 'wing_designations', c: '(wing templates)', n, action: 'delete link rows' });
    }
    console.table(plan);
    if (plan.some((p) => p.action.startsWith('NOT NULLABLE'))) throw new Error('A non-nullable reference exists; refusing to continue.');

    if (!APPLY) { console.log('\nDRY RUN — nothing changed. Re-run with --apply to back up and clear.'); return; }

    // Mandatory backup of every table this touches.
    const tables = ['designations', ...new Set(plan.map((p) => p.t))];
    const out = path.resolve(process.cwd(), `designations-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`);
    const dump = spawnSync('mysqldump', [`-h${cfg.host}`, `-P${cfg.port}`, `-u${cfg.user}`, `--result-file=${out}`, '--single-transaction', cfg.database, ...tables],
      { env: { ...process.env, MYSQL_PWD: cfg.password }, encoding: 'utf8' });
    if (dump.status !== 0 || !fs.existsSync(out) || fs.statSync(out).size < 100) {
      throw new Error(`Backup failed (${dump.stderr || 'mysqldump unavailable'}); nothing was changed.`);
    }
    console.log(`Backup written: ${out} (${fs.statSync(out).size} bytes)`);

    await conn.beginTransaction();
    try {
      for (const p of plan) {
        if (REPORT_ONLY.has(p.t) || p.t === 'wing_designations' || (MINIMAL && p.t !== 'contacts')) continue;
        if (DELETE_ROWS.has(p.t)) await conn.query(`DELETE FROM \`${p.t}\``);
        else await conn.query(`UPDATE \`${p.t}\` SET \`${p.c}\` = NULL WHERE \`${p.c}\` IS NOT NULL`);
      }
      if (wd && !MINIMAL) await conn.query('DELETE FROM wing_designations');
      await conn.query('DELETE FROM designations');
      // The 14 default State designations are re-seeded at app start unless this
      // ledger row exists. It normally already does; make sure, so the cleared
      // list is not silently repopulated.
      const [[{ n: led }]] = await conn.query("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_migrations'");
      if (led) await conn.query("INSERT IGNORE INTO app_migrations (name) VALUES ('seed_main_state_designations_v1')");
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; }
    const [[{ n: left }]] = await conn.query('SELECT COUNT(*) n FROM designations');
    console.log(`Done. Designations remaining: ${left}.`);
  } finally { await conn.end(); }
}
run().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
