import { query, withConnection } from "@/lib/db";

// Backend/DB-owned, per-module, MONOTONIC "Spokesperson N" numbering for the TV
// Debate (`debates`) and Press Conference (`press_conferences`) modules.
//
// Design (why the earlier attempt was wrong): the previous version allocated the
// LOWEST AVAILABLE number, so deleting a low record made the next create REUSE
// that number (e.g. "Spokesperson 1" reappearing). This version never reuses a
// number: each module keeps a persistent counter (`spokesperson_sequences`) of
// the highest number EVER issued, and the next create is always counter+1 —
// monotonic, independent per module, and unaffected by deletes, edits, sorting,
// filtering or pagination.
//
// Concurrency: the counter is bumped with the atomic MySQL LAST_INSERT_ID()
// sequence trick on a single connection, so two simultaneous creates get two
// different numbers. A UNIQUE index on each table's spokesperson_number is the
// database-level backstop; a create retries if it ever hits that constraint.

const TABLES = new Set(["debates", "press_conferences"]);
const ensured = {}; // per-process, per-table

function assertTable(table) {
  if (!TABLES.has(table)) throw new Error(`spokespersonNumber: unsupported table "${table}"`);
  return table;
}

async function columnExists(table, column) {
  const rows = await query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0]?.n || 0) > 0;
}
async function indexExists(table, index) {
  const rows = await query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );
  return Number(rows[0]?.n || 0) > 0;
}

async function ensureSequenceTable() {
  await query(
    `CREATE TABLE IF NOT EXISTS spokesperson_sequences (
       module      VARCHAR(32) PRIMARY KEY,
       last_number INT NOT NULL DEFAULT 0,
       updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

// Seed/raise a module's counter so it is never below the highest number the
// table already holds — monotonic even across restarts, and never lowers it.
async function seedSequence(module) {
  await query(
    `INSERT INTO spokesperson_sequences (module, last_number)
       SELECT ?, COALESCE(MAX(spokesperson_number), 0) FROM ${module}
     ON DUPLICATE KEY UPDATE last_number = GREATEST(last_number, VALUES(last_number))`,
    [module]
  );
}

// Atomically bump the counter and return the NEW value — the next number to use.
// INSERT ... ON DUPLICATE KEY UPDATE runs under a row lock, and LAST_INSERT_ID()
// is connection-scoped, so concurrent callers each read their own distinct value
// (N, N+1, …) — no duplicates, no lost updates (§12, §27).
async function allocate(module) {
  return withConnection(async (conn) => {
    await conn.execute(
      `INSERT INTO spokesperson_sequences (module, last_number)
         VALUES (?, LAST_INSERT_ID(1))
       ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`,
      [module]
    );
    const [rows] = await conn.execute(`SELECT LAST_INSERT_ID() AS n`);
    return Number(rows[0]?.n || 0);
  });
}

// Repair any duplicate numbers left by an older implementation (§22): keep the
// lowest id for each number, give every other colliding row a fresh monotonic
// number. Nothing is deleted; only spokesperson_number changes.
async function repairDuplicates(module) {
  const dupes = await query(
    `SELECT t.id
       FROM ${module} t
       JOIN (
         SELECT spokesperson_number AS num, MIN(id) AS keep_id
           FROM ${module}
          WHERE spokesperson_number IS NOT NULL
          GROUP BY spokesperson_number
         HAVING COUNT(*) > 1
       ) d ON d.num = t.spokesperson_number AND t.id <> d.keep_id
      ORDER BY t.id ASC`
  );
  for (const r of dupes) {
    const n = await allocate(module);
    await query(`UPDATE ${module} SET spokesperson_number = ? WHERE id = ?`, [n, r.id]);
  }
}

// Assign a number to every row that lacks one, oldest first (deterministic by
// created_at then id), each drawn from the monotonic counter — so existing rows
// get permanent numbers and are never renumbered again (§21).
async function backfillMissing(module) {
  const orderCol = (await columnExists(module, "created_at")) ? "created_at" : "id";
  const missing = await query(
    `SELECT id FROM ${module} WHERE spokesperson_number IS NULL ORDER BY ${orderCol} ASC, id ASC`
  );
  for (const r of missing) {
    const n = await allocate(module);
    try {
      await query(`UPDATE ${module} SET spokesperson_number = ? WHERE id = ?`, [n, r.id]);
    } catch (e) {
      if (!(e && (e.code === "ER_DUP_ENTRY" || e.errno === 1062))) throw e;
    }
  }
}

export async function ensureSpokespersonNumberSchema(table) {
  assertTable(table);
  if (ensured[table]) return;
  try {
    if (!(await columnExists(table, "spokesperson_number"))) {
      await query(`ALTER TABLE ${table} ADD COLUMN spokesperson_number INT NULL`);
    }
    await ensureSequenceTable();
    await seedSequence(table);        // counter ≥ current MAX before we allocate
    await repairDuplicates(table);    // fix legacy duplicates, then it's safe to…
    await backfillMissing(table);     // number any rows still missing one
    const idx = `uq_${table}_spokesperson_number`;
    if (!(await indexExists(table, idx))) {
      await query(`ALTER TABLE ${table} ADD UNIQUE INDEX ${idx} (spokesperson_number)`);
    }
    ensured[table] = true;
  } catch (e) {
    console.error(`[spokespersonNumber] ensure ${table}:`, e?.message || e);
  }
}

// Allocate the next monotonic number and run doInsert(number) to create the row.
// On the rare UNIQUE clash (e.g. a hand-inserted number), recompute and retry so
// a valid unique number is always saved and no row is half-created (§35).
export async function createWithSpokespersonNumber(table, doInsert) {
  assertTable(table);
  await ensureSpokespersonNumberSchema(table);
  let lastErr;
  for (let attempt = 0; attempt < 8; attempt++) {
    const number = await allocate(table);
    try {
      const res = await doInsert(number);
      return { res, number };
    } catch (e) {
      if (e && (e.code === "ER_DUP_ENTRY" || e.errno === 1062)) { lastErr = e; continue; }
      throw e;
    }
  }
  throw lastErr || new Error("could not allocate a spokesperson number");
}
