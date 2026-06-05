import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Tables to fully wipe. KEEPS:
//   - locations (CG geography)
//   - call_statuses (master data)
//   - designations (master data)
//   - schema itself (no DROP TABLE)
const WIPE_TABLES = [
  // Transactional / per-row data
  'workers',
  'teams',
  'team_members',
  'tasks',
  'complaints',
  'training_modules',
  'training_progress',
  'badges',
  'worker_badges',
  'social_pages',
  'social_posts',
  'media_library',
  'social_analytics',
  'newspapers',
  'press_notes',
  'news_channels',
  'debates',
  'debate_assignments',
  'spokespersons',
  'press_conferences',
  'journalists',
  'journalist_invites',
  'contacts',
  'calls',
  'attendance_log',
  'notifications',
  // Users last — they're referenced by many FKs
  'users',
];

// One user per canonical role. Username = role; password = role.
// You can change these later from the Users admin page.
const SEED_USERS = [
  { username: 'superadmin',    password: 'superadmin',    role: 'super_admin' },
  { username: 'stateadmin',    password: 'stateadmin',    role: 'state_admin' },
  { username: 'zoneadmin',     password: 'zoneadmin',     role: 'zone_admin' },
  { username: 'districtadmin', password: 'districtadmin', role: 'district_admin' },
  { username: 'assemblyadmin', password: 'assemblyadmin', role: 'assembly_admin' },
  { username: 'supervisor',    password: 'supervisor',    role: 'supervisor' },
  { username: 'caller',        password: 'caller',        role: 'caller' },
  { username: 'worker',        password: 'worker',        role: 'worker' },
];

async function tableExists(conn, name) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
    [name]
  );
  return rows.length > 0;
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aapadmin',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  multipleStatements: false,
});

try {
  console.log('Disabling FK checks for clean truncate...');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');

  for (const t of WIPE_TABLES) {
    if (await tableExists(conn, t)) {
      await conn.query(`TRUNCATE TABLE ${t}`);
      console.log(`  ✓ wiped ${t}`);
    } else {
      console.log(`  – ${t} (not present, skipped)`);
    }
  }

  await conn.query('SET FOREIGN_KEY_CHECKS = 1');

  console.log('\nCreating one user per role...');
  for (const u of SEED_USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    await conn.query(
      `INSERT INTO users (username, password, role, is_active) VALUES (?, ?, ?, 1)`,
      [u.username, hash, u.role]
    );
    console.log(`  + ${u.username.padEnd(15)} role=${u.role.padEnd(15)} password=${u.password}`);
  }

  // Sanity check what we kept
  const [[locC]]  = await conn.query(`SELECT COUNT(*) AS n FROM locations`);
  const [[stC]]   = await conn.query(`SELECT COUNT(*) AS n FROM call_statuses`);
  const [[deC]]   = await conn.query(`SELECT COUNT(*) AS n FROM designations`).catch(() => [[{ n: 0 }]]);
  const [[usC]]   = await conn.query(`SELECT COUNT(*) AS n FROM users`);

  console.log('\nKept (master data):');
  console.log(`  locations:     ${locC.n}`);
  console.log(`  call_statuses: ${stC.n}`);
  console.log(`  designations:  ${deC.n}`);
  console.log(`  users:         ${usC.n}`);
  console.log('\nDone. Sign in with any role-named account (password = same as username).');
} catch (err) {
  console.error('Wipe failed:', err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
