// Verify Leader Assessment candidate completion directly against the database.
//
// Completion is NOT stored — la_candidate_assessments holds only the 10 score
// columns (s_nature … s_acceptability), and every surface derives "Completed"
// as: ALL 10 scores present and > 0 (the shared assessmentComplete rule). So a
// record can never be "COMPLETED with < 10 filled" — this script proves it by
// counting the filled parameters per candidate and printing the derived status.
//
//   node scripts/check-la-assessment-completion.mjs
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const conn = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: parseInt(process.env.DB_PORT, 10),
});

const PARAMS = [
  "s_nature", "s_hardworker", "s_financial", "s_political", "s_public_reach",
  "s_social_reach", "s_personality", "s_organization", "s_winning", "s_acceptability",
];
const filledExpr = PARAMS.map((k) => `(CASE WHEN s.${k} > 0 THEN 1 ELSE 0 END)`).join(" + ");

const [rows] = await conn.query(
  `SELECT c.id, c.name, ml.name AS assembly,
          COALESCE(${filledExpr}, 0) AS filled,
          COALESCE(${PARAMS.map((k) => `COALESCE(s.${k},0)`).join(" + ")}, 0) AS total
     FROM la_aap_candidates c
     JOIN la_assemblies a ON a.id = c.assembly_id
     JOIN locations ml ON ml.id = a.location_id AND ml.type = 'assembly'
     LEFT JOIN la_candidate_assessments s ON s.candidate_id = c.id
    WHERE c.name IS NOT NULL AND TRIM(c.name) <> ''
    ORDER BY ml.name, c.name`
);

let completed = 0;
console.log("cand_id  filled/10  total/100  status      candidate — assembly");
console.log("-".repeat(72));
for (const r of rows) {
  const filled = Number(r.filled);
  const status = filled === 10 ? "COMPLETED" : "INCOMPLETE";
  if (filled === 10) completed++;
  console.log(
    String(r.id).padEnd(8),
    `${filled}/10`.padEnd(10),
    `${Number(r.total)}/100`.padEnd(10),
    status.padEnd(11),
    `${r.name} — ${r.assembly}`
  );
}
console.log("-".repeat(72));
console.log(`Candidates: ${rows.length}   Assessment Done (10/10): ${completed}`);
console.log("This 'Assessment Done' number must equal Overview → Assessment Done.");

await conn.end();
