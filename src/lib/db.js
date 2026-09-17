import mysql from 'mysql2/promise';

let pool;
let mediaPool;

// Cap every statement so one slow/locked query can't hold a connection (and
// the server process behind the request) open forever. When it fires, mysql2
// closes that connection and the pool replaces it.
const STATEMENT_TIMEOUT_MS = Number(process.env.DB_STATEMENT_TIMEOUT_MS) || 15000;

// CRITICAL: mysql2's per-query `timeout` option is IGNORED by execute()
// (prepared statements), so a query that stalls on a lock would hold its pooled
// connection forever, exhausting the pool. Enforce the cap at the DATABASE level
// on each new connection instead (a hard statement time limit + short lock-wait
// timeouts), so the DB kills any stalled query/lock and RELEASES the connection.
// Variable names differ across MariaDB (max_statement_time, seconds) and MySQL
// (max_execution_time, ms), and setting an unknown one errors, so detect first.
function applySessionGuards(p) {
  const secs = Math.max(1, Math.round(STATEMENT_TIMEOUT_MS / 1000));
  p.on("connection", (conn) => {
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

function baseConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aapadmin',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    // Return DATE columns (e.g. follow_up_date, deadline) as plain 'YYYY-MM-DD'
    // strings instead of JS Date objects — otherwise mysql2 builds a Date at the
    // server-local midnight, which serializes UTC-shifted and shows a date one day
    // off on non-UTC servers. DATETIME/TIMESTAMP columns are unaffected.
    dateStrings: ['DATE'],
    waitForConnections: true,
    connectTimeout: 10000,
    enableKeepAlive: true,      // avoid stale-socket errors that trigger retries
    keepAliveInitialDelay: 10000,
    idleTimeout: 60000,
  };
}

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...baseConfig(),
      connectionLimit: 10,
      // Bound the backlog. With queueLimit:0 (unlimited), a DB slowdown lets
      // requests queue without limit — each holds a server process, which pegs
      // the host's Max Processes cap and 503s the whole app. A bound makes excess
      // requests fail fast (freeing the process) instead.
      queueLimit: 50,
      maxIdle: 10,
    });
    applySessionGuards(pool);
  }
  return pool;
}

// A SEPARATE, small pool dedicated to serving media blobs (contact/candidate/etc.
// photos via /api/media/[file]). A Contact List page fires dozens of image
// requests at once; on the shared pool that burst competed with — and could
// exhaust — the connections the page's own data queries needed, so some images
// failed and showed blank. Isolating media reads onto their own pool means an
// image burst queues among itself and never starves API queries (or vice versa).
// A larger queue lets a full page of images WAIT their turn instead of being
// rejected; each read is a fast single-row blob fetch, and the in-process cache
// (mediaFileStore) absorbs repeats so most page loads touch the DB very little.
export function getMediaPool() {
  if (!mediaPool) {
    const limit = Math.max(2, Number(process.env.DB_MEDIA_POOL_SIZE) || 6);
    mediaPool = mysql.createPool({
      ...baseConfig(),
      connectionLimit: limit,
      queueLimit: 500,
      maxIdle: limit,
    });
    applySessionGuards(mediaPool);
  }
  return mediaPool;
}

export async function mediaQuery(sql, params) {
  const [results] = await getMediaPool().execute({ sql, values: params, timeout: STATEMENT_TIMEOUT_MS });
  return results;
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

// Run several statements on ONE pooled connection (released afterward). Needed
// when a sequence of statements must share connection-scoped state — e.g. the
// MySQL LAST_INSERT_ID() sequence trick used for monotonic number allocation,
// where the increment and the read-back must be on the same connection.
export async function withConnection(fn) {
  const connectionPool = getPool();
  const conn = await connectionPool.getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}
