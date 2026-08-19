// Verify Leader Assessment ASSEMBLY completion directly against the database.
//
// Assembly completion is NOT stored — it is derived by the shared rule
// (assemblyComplete): an assembly is COMPLETED only when it has at least one
// candidate AND every candidate's 10-parameter assessment is complete (all 10
// scores > 0). This is the same calculation the Overview card, Assemblies List
// and Full View use, so this script's result must match all of them.
//
//   node scripts/check-la-assembly-completion.mjs
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
const candComplete = PARAMS.map((k) => `s.${k} > 0`).join(" AND ");

// Per master-linked assembly: total candidates and how many are fully assessed.
const [rows] = await conn.query(
  `SELECT a.id AS assembly_id, ml.name AS assembly,
          COUNT(c.id) AS candidates,
          SUM(CASE WHEN (${candComplete}) THEN 1 ELSE 0 END) AS completed_candidates
     FROM la_assemblies a
     JOIN locations ml ON ml.id = a.location_id AND ml.type = 'assembly'
     LEFT JOIN la_aap_candidates c ON c.assembly_id = a.id
     LEFT JOIN la_candidate_assessments s ON s.candidate_id = c.id
    GROUP BY a.id, ml.name
    ORDER BY ml.name`
);

let completedAssemblies = 0;
console.log("assembly_id  cands  completed  status       assembly");
console.log("-".repeat(64));
for (const r of rows) {
  const cands = Number(r.candidates);
  const done = Number(r.completed_candidates);
  // assemblyComplete: >=1 candidate AND all candidates complete.
  const status = cands > 0 && done === cands ? "COMPLETED" : "INCOMPLETE";
  if (status === "COMPLETED") completedAssemblies++;
  console.log(
    String(r.assembly_id).padEnd(12),
    String(cands).padEnd(6),
    String(done).padEnd(10),
    status.padEnd(12),
    r.assembly
  );
}
console.log("-".repeat(64));
console.log(`Assemblies: ${rows.length}   Completed: ${completedAssemblies}`);
console.log("This 'Completed' number must equal Overview → Total Completed Assemblies");
console.log("and the count of 'Completed' rows in the Assemblies List.");

await conn.end();
