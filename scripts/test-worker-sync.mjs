// Automated test for contact <-> worker synchronization.
//
//   node scripts/test-worker-sync.mjs
//
// Exercises the REAL helper (src/lib/workerSync.js) against the configured DB
// inside a transaction that is always rolled back — no data is persisted. Exits
// non-zero if any assertion fails, so it can gate a deploy.

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { syncContactToWorker, syncWorkerToContact } from "../src/lib/workerSync.js";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "aapadmin",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306, dateStrings: ["DATE"],
});

let failures = 0;
const assert = (cond, msg) => { console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++; };
const LAST10 = "RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(mobile,' ',''),'-',''),'+',''),'(',''),')',''),'.',''),10)";

const [desigs] = await conn.query("SELECT id, name FROM designations ORDER BY id LIMIT 2");
const [[dist]] = await conn.query("SELECT id FROM locations WHERE type='district' LIMIT 1");
const [[lok]] = await conn.query("SELECT id FROM locations WHERE type='lok_sabha' LIMIT 1");
const [[ward]] = await conn.query("SELECT id FROM locations WHERE type='ward' LIMIT 1");

await conn.beginTransaction();
try {
  // A) Edit an existing contact -> worker mirrors name/address/district/designation
  console.log("A) Contact edit -> Worker update (incl. designation)");
  const [[c]] = await conn.query("SELECT id, worker_id FROM contacts WHERE worker_id IS NOT NULL LIMIT 1");
  if (!c) { assert(false, "no linked contact found — run scripts/link-contacts-workers.mjs first"); }
  else {
    await conn.query(
      "UPDATE contacts SET person_name='SYNC TEST', address='SYNC ADDR', lok_sabha_id=?, district_id=?, ward_id=?, designation_id=? WHERE id=?",
      [lok?.id ?? null, dist.id, ward?.id ?? null, desigs[0].id, c.id]);
    await syncContactToWorker(conn, c.id);
    const [[w]] = await conn.query("SELECT name, address, lok_sabha_id, district_id, ward_id, position FROM workers WHERE id=?", [c.worker_id]);
    assert(w.name === "SYNC TEST", "worker name updated");
    assert(w.address === "SYNC ADDR", "worker ADDRESS updated");
    assert(String(w.lok_sabha_id) === String(lok?.id ?? null), "worker LOK SABHA updated");
    assert(String(w.district_id) === String(dist.id), "worker district updated");
    assert(String(w.ward_id) === String(ward?.id ?? null), "worker BLOCK (ward) updated");
    assert(w.position === desigs[0].name, `worker designation/position updated to '${desigs[0].name}'`);
  }

  // B) New contact with a novel phone -> a worker is created and linked (no dup)
  console.log("B) New contact -> Worker created + linked (no duplicate)");
  const novel = "9" + String(Date.now()).slice(-9);
  const [insC] = await conn.query("INSERT INTO contacts (person_name, phone_number, address, designation_id, district_id) VALUES ('NEW PERSON', ?, 'NEW ADDR', ?, ?)",
    [novel, desigs[1].id, dist.id]);
  const newContactId = insC.insertId;
  const workerId = await syncContactToWorker(conn, newContactId);
  const [[link]] = await conn.query("SELECT worker_id FROM contacts WHERE id=?", [newContactId]);
  const [[cnt]] = await conn.query(`SELECT COUNT(*) n FROM workers WHERE ${LAST10} = ?`, [novel]);
  assert(!!workerId, "a worker was created for the new contact");
  assert(String(link.worker_id) === String(workerId), "contact.worker_id link was set");
  assert(cnt.n === 1, `exactly one worker exists for the phone (no duplicate) — found ${cnt.n}`);
  const [[nw]] = await conn.query("SELECT name, position, district_id FROM workers WHERE id=?", [workerId]);
  assert(nw.position === desigs[1].name, "created worker has the mapped designation");

  // C) Edit a worker -> its linked contact mirrors the change (incl. designation)
  console.log("C) Worker edit -> Contact update (incl. designation)");
  await conn.query("UPDATE workers SET name='WK EDIT', address='WK ADDR', position=? WHERE id=?", [desigs[0].name, workerId]);
  const cid = await syncWorkerToContact(conn, workerId);
  const [[cc]] = await conn.query("SELECT person_name, address, designation_id FROM contacts WHERE id=?", [cid]);
  assert(cc.person_name === "WK EDIT", "contact name updated from worker");
  assert(cc.address === "WK ADDR", "contact address updated from worker");
  assert(String(cc.designation_id) === String(desigs[0].id), "contact designation mapped from worker.position");

  // D) Idempotency: re-running sync doesn't create extra workers
  console.log("D) Re-sync is idempotent (no duplicate workers)");
  await syncContactToWorker(conn, newContactId);
  const [[cnt2]] = await conn.query(`SELECT COUNT(*) n FROM workers WHERE ${LAST10} = ?`, [novel]);
  assert(cnt2.n === 1, `still exactly one worker after re-sync — found ${cnt2.n}`);
} finally {
  await conn.rollback(); // never persist test data
  await conn.end();
}

console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
