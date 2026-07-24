import mysql from 'mysql2/promise';

let pool;

// Cap every statement so one slow/locked query can't hold a connection (and
// the server process behind the request) open forever. When it fires, mysql2
// closes that connection and the pool replaces it.
const STATEMENT_TIMEOUT_MS = Number(process.env.DB_STATEMENT_TIMEOUT_MS) || 15000;

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'aapadmin',
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
      // Return DATE columns (e.g. follow_up_date, deadline) as plain 'YYYY-MM-DD'
      // strings instead of JS Date objects. Otherwise mysql2 builds a Date at the
      // server-local midnight, which serializes to a UTC-shifted ISO string and
      // shows the reminder/deadline one day off on non-UTC servers. DATETIME/
      // TIMESTAMP columns (called_at, locked_at, …) are unaffected.
      dateStrings: ['DATE'],
      waitForConnections: true,
      connectionLimit: 10,
      // Bound the backlog. With queueLimit:0 (unlimited), a DB slowdown lets
      // requests queue without limit — each holds a server process, which is
      // what pegs the host's Max Processes cap and 503s the whole app. A bound
      // makes excess requests fail fast (freeing the process) instead.
      queueLimit: 50,
      connectTimeout: 10000,      // don't hang forever if the DB is unreachable
      maxIdle: 10,
      idleTimeout: 60000,         // reap idle connections
      enableKeepAlive: true,      // avoid stale-socket errors that trigger retries
      keepAliveInitialDelay: 10000,
    });
  }
  return pool;
}

export async function query(sql, params) {
  const connectionPool = getPool();
  const [results] = await connectionPool.execute({
    sql,
    values: params,
    timeout: STATEMENT_TIMEOUT_MS,
  });
  return results;
}
