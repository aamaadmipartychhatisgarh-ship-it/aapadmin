import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aapadmin',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
});

async function hasTeam(name, level) {
  const [r] = await conn.query(`SELECT id FROM teams WHERE name=? AND level=? LIMIT 1`, [name, level]);
  return r.length > 0;
}
async function addTeam(name, level, locationId = null) {
  if (await hasTeam(name, level)) return null;
  const [r] = await conn.query(
    `INSERT INTO teams (name, level, location_id) VALUES (?, ?, ?)`, [name, level, locationId]
  );
  return r.insertId;
}

try {
  const counts = { lok_sabha: 0, assembly: 0, ward: 0, mandal: 0, booth: 0 };

  // Lok Sabha teams — one per lok_sabha location
  const [lokSabhas] = await conn.query(`SELECT id, name FROM locations WHERE type='lok_sabha'`);
  for (const ls of lokSabhas) {
    if (await addTeam(`${ls.name} Lok Sabha Team`, 'lok_sabha', ls.id)) counts.lok_sabha++;
  }

  // Assembly teams — one per assembly location (cap at 20 to keep it readable)
  const [assemblies] = await conn.query(`SELECT id, name FROM locations WHERE type='assembly' LIMIT 20`);
  for (const a of assemblies) {
    if (await addTeam(`${a.name} Vidhan Sabha Team`, 'assembly', a.id)) counts.assembly++;
  }

  // Ward / Mandal / Booth — these granular locations aren't in the locations table,
  // so create representative teams under the first few assemblies by name.
  const sampleAssemblies = assemblies.slice(0, 4);
  for (const a of sampleAssemblies) {
    for (let w = 1; w <= 3; w++) {
      if (await addTeam(`${a.name} - Ward ${w} Team`, 'ward', a.id)) counts.ward++;
    }
    for (let m = 1; m <= 2; m++) {
      if (await addTeam(`${a.name} - Mandal ${m} Team`, 'mandal', a.id)) counts.mandal++;
    }
    for (let b = 1; b <= 4; b++) {
      if (await addTeam(`${a.name} - Booth ${String(b).padStart(3, '0')} Team`, 'booth', a.id)) counts.booth++;
    }
  }

  // Distribute some workers into the new teams so they aren't empty
  const [workers] = await conn.query(`SELECT id FROM workers ORDER BY RAND() LIMIT 60`);
  const [newTeams] = await conn.query(
    `SELECT id FROM teams WHERE level IN ('lok_sabha','assembly','ward','mandal','booth')`
  );
  let assigned = 0;
  for (let i = 0; i < workers.length && newTeams.length; i++) {
    const team = newTeams[i % newTeams.length];
    const [res] = await conn.query(
      `INSERT IGNORE INTO team_members (team_id, worker_id) VALUES (?, ?)`,
      [team.id, workers[i].id]
    );
    if (res.affectedRows) assigned++;
  }

  // Final per-level counts
  const [[totals]] = await conn.query(`
    SELECT
      SUM(level='state') AS state, SUM(level='zone') AS zone, SUM(level='lok_sabha') AS lok_sabha,
      SUM(level='district') AS district, SUM(level='assembly') AS assembly,
      SUM(level='ward') AS ward, SUM(level='mandal') AS mandal, SUM(level='booth') AS booth
    FROM teams`);

  console.log('Added:', counts);
  console.log('Assigned members:', assigned);
  console.log('Teams by level:', totals);
  console.log('Done.');
} catch (err) {
  console.error('Seed failed:', err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
