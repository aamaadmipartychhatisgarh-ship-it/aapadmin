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

    // CRITICAL: mysql2's per-query `timeout` option is IGNORED by execute()
    // (prepared statements), so a query that stalls on a lock would hold its
    // pooled connection forever. Under concurrent load the 10-connection pool
    // then exhausts and EVERY new query waits forever for a free connection —
    // a request hangs indefinitely (the production-only "Saving…" forever).
    // Enforce the cap at the DATABASE level instead: on each new connection set
    // a hard statement time limit plus short lock-wait timeouts, so the DB
    // kills any stalled query/lock and RELEASES the connection back to the pool.
    // Set individually + best-effort because variable names differ across
    // MariaDB (max_statement_time, seconds) and MySQL (max_execution_time, ms).
    const secs = Math.max(1, Math.round(STATEMENT_TIMEOUT_MS / 1000));
    // The pool 'connection' event hands back a CALLBACK-style connection (not
    // the promise wrapper), so use conn.query(sql, cb) and swallow errors in the
    // callback. Detect the server flavor first: the statement-timeout variable
    // differs (MariaDB: max_statement_time in seconds; MySQL: max_execution_time
    // in ms). Setting an unknown variable errors, so pick the right one. The
    // lock-wait timeouts exist on both and bound how long a query waits on a
    // metadata/row lock (the main cause of a stuck connection).
    pool.on("connection", (conn) => {
      const set = (sql) => { try { conn.query(sql, () => {}); } catch { /* ignore */ } };
      try {
        conn.query("SELECT VERSION() AS v", (err, rows) => {
          if (!err) {
            const isMaria = String(rows?.[0]?.v || "").toLowerCase().includes("mariadb");
            set(isMaria ? `SET SESSION max_statement_time=${secs}` : `SET SESSION max_execution_time=${STATEMENT_TIMEOUT_MS}`);
          }
          set(`SET SESSION lock_wait_timeout=${secs}`);
          set(`SET SESSION innodb_lock_wait_timeout=${secs}`);
        });
      } catch { /* ignore */ }
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
