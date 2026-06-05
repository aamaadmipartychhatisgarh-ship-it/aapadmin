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

try {
  console.log('1. Snapshot before deletion...');
  const [before] = await conn.query(
    `SELECT u.username, u.role, COUNT(*) AS n
       FROM calls c JOIN users u ON u.id = c.user_id
       GROUP BY u.id, u.username, u.role`
  );
  before.forEach(r => console.log(`   ${r.username} (${r.role}): ${r.n}`));

  console.log('2. Deleting calls where user.role IN (admin, supervisor)...');
  const [del] = await conn.query(
    `DELETE c FROM calls c
       JOIN users u ON u.id = c.user_id
      WHERE u.role IN ('admin','supervisor')`
  );
  console.log(`   deleted ${del.affectedRows} calls`);

  console.log('3. Recomputing contact completion state...');
  // Contacts that were marked complete *because* of a deleted admin call should
  // reopen ONLY IF they no longer have any remaining "final-status" call from a
  // legitimate caller.
  await conn.query(
    `UPDATE contacts ct
        LEFT JOIN (
          SELECT contact_id
            FROM calls c
            JOIN call_statuses cs ON cs.id = c.status_id
           WHERE cs.name IN ('Phone Picked','Wrong Number','Rudely Behaved')
           GROUP BY contact_id
        ) finals ON finals.contact_id = ct.id
        SET ct.is_completed = CASE WHEN finals.contact_id IS NOT NULL THEN 1 ELSE 0 END`
  );

  console.log('4. Recount...');
  const [after] = await conn.query(
    `SELECT u.username, u.role, COUNT(*) AS n
       FROM calls c JOIN users u ON u.id = c.user_id
       GROUP BY u.id, u.username, u.role`
  );
  after.forEach(r => console.log(`   ${r.username} (${r.role}): ${r.n}`));

  const [[contactStats]] = await conn.query(
    `SELECT COUNT(*) AS total,
            SUM(is_completed) AS completed,
            SUM(CASE WHEN is_completed = 0 THEN 1 ELSE 0 END) AS pending
       FROM contacts`
  );
  console.log(`   contacts: ${contactStats.total} total, ${contactStats.completed} completed, ${contactStats.pending} pending`);

  console.log('Done.');
} catch (err) {
  console.error('Cleanup failed:', err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
