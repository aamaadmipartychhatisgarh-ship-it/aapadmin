// Designation cleanup + custom party-hierarchy ordering.
//
// Run against a target DB by setting the DB_* env (uses .env.local by default):
//   node scripts/designation-order-migration.mjs
//
// What it does (idempotent):
//   1. Adds designations.sort_order (INT NULL) if missing.
//   2. Normalizes the "Block Organising Secretary" / "Block Organiser" /
//      "Block sanghthan mantr" naming -> "Block Sanghthan Mantri".
//   3. Also updates existing worker.position / contact designation links that
//      still carry the old free-text names, so the Worker page stops showing
//      "Block Organiser".
//   4. Sets sort_order for the requested top sequence; everything else stays NULL
//      (sorts alphabetically after the ordered ones).
//
// REVIEW before running on production. This edits designation names + a few
// worker.position strings. It does NOT delete any rows.

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// The exact top-of-list order the party wants. Names must match DB rows (we
// create any missing ones as new designations so the order is complete).
const ORDER = [
  "Loksabha Prabhari",
  "Loksabha President",
  "District Prabhari",
  "District President",
  "District Sanghathan Mantri",
  "Vidhansabha Prabhari",
  "Vidhansabha President",
  "Vidhansabha Sangathan Mantri",
  "Block President",
  "Block Sanghathan Mantri",
];

// Old name -> canonical name (fixes the Block Organiser / typo variants).
const RENAMES = {
  "Block Organising Secretary": "Block Sanghathan Mantri",
  "Block Organizing Secretary": "Block Sanghathan Mantri",
  "Block Organiser": "Block Sanghathan Mantri",
  "Block Organizer": "Block Sanghathan Mantri",
  "Block sanghthan mantr": "Block Sanghathan Mantri",
  "Block Sanghthan Mantri": "Block Sanghathan Mantri",
  "Vidhansbaha Prabhari": "Vidhansabha Prabhari",
  "Vidhansabha Sangathan Mantri": "Vidhansabha Sangathan Mantri",
};

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  });
  console.log("connected to", process.env.DB_HOST, "/", process.env.DB_NAME);

  // 1. add sort_order column if missing
  const [cols] = await c.query("SHOW COLUMNS FROM designations LIKE 'sort_order'");
  if (cols.length === 0) {
    await c.query("ALTER TABLE designations ADD COLUMN sort_order INT NULL");
    console.log("+ added designations.sort_order");
  } else console.log("= sort_order already exists");

  // 2 + 3. normalize names on the designations table AND on worker.position text
  for (const [oldName, newName] of Object.entries(RENAMES)) {
    if (oldName === newName) continue;
    // designations table: rename, but avoid a duplicate-name collision
    const [existsNew] = await c.query("SELECT id FROM designations WHERE name = ?", [newName]);
    const [existsOld] = await c.query("SELECT id FROM designations WHERE name = ?", [oldName]);
    if (existsOld.length && existsNew.length) {
      // both exist → repoint contacts to the canonical, drop the old
      await c.query("UPDATE contacts SET designation_id = ? WHERE designation_id = ?", [existsNew[0].id, existsOld[0].id]);
      await c.query("DELETE FROM designations WHERE id = ?", [existsOld[0].id]);
      console.log(`  merged designation "${oldName}" -> "${newName}"`);
    } else if (existsOld.length) {
      await c.query("UPDATE designations SET name = ? WHERE id = ?", [newName, existsOld[0].id]);
      console.log(`  renamed designation "${oldName}" -> "${newName}"`);
    }
    // worker.position free-text: replace the old token with the new one
    const [wr] = await c.query(
      "UPDATE workers SET position = REPLACE(position, ?, ?) WHERE position LIKE ?",
      [oldName, newName, `%${oldName}%`]
    );
    if (wr.affectedRows) console.log(`  updated ${wr.affectedRows} worker.position "${oldName}"`);
  }

  // 4. ensure every ORDER name exists (create missing), then set sort_order
  for (let i = 0; i < ORDER.length; i++) {
    const name = ORDER[i];
    let [row] = await c.query("SELECT id FROM designations WHERE name = ?", [name]);
    if (row.length === 0) {
      const res = await c.query("INSERT INTO designations (name, sort_order) VALUES (?, ?)", [name, i + 1]);
      console.log(`  + created "${name}" (sort ${i + 1})`);
    } else {
      await c.query("UPDATE designations SET sort_order = ? WHERE id = ?", [i + 1, row[0].id]);
      console.log(`  set "${name}" sort_order=${i + 1}`);
    }
  }

  // report
  const [final] = await c.query("SELECT name, sort_order FROM designations ORDER BY (sort_order IS NULL), sort_order ASC, name ASC LIMIT 15");
  console.log("\nfinal order (first 15):");
  final.forEach((d) => console.log(`  ${d.sort_order ?? "-"}\t${d.name}`));
  await c.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
