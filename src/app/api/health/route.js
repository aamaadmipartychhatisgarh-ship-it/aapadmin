// GET /api/health (and GET /health via the next.config rewrite) — a liveness
// probe that returns immediately and touches NOTHING heavy: no session, no
// database, no dashboard queries. If the Node process is alive and its event
// loop is responsive, this returns 200 instantly; if it hangs, the process
// itself is unhealthy (not a slow query), which is exactly the signal an uptime
// monitor / restart hook needs to distinguish "backend down" from "one page slow".
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(
    JSON.stringify({ status: "ok", ts: new Date().toISOString() }),
    { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}
