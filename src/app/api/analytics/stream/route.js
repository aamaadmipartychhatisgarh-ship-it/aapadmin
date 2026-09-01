// GET /api/analytics/stream — RETIRED.
//
// This used to be a Server-Sent Events (SSE) stream that stayed open for the
// life of every Analytics tab. On this app's shared Node hosting each such
// long-lived connection holds a worker/connection slot, and the browser's
// EventSource auto-reconnects (~3s) whenever the proxy drops the stream — so the
// open connections accumulate and starve ordinary requests, until even a plain
// GET / (which only redirects) can't get a worker and nginx returns 504. That is
// the recurring production 504.
//
// Live analytics no longer needs a persistent connection: the client refreshes
// on a lightweight 45s poll plus tab-focus (see hooks/useLiveAnalytics.js), which
// can never hold a worker open. This endpoint now returns 204 No Content, which
// per the EventSource spec tells any stale tab still connected here to CLOSE and
// NOT reconnect — so old connections drain instead of looping. It returns
// instantly and touches no session or database, so it can never hang.
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
