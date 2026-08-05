import { getServerSession } from "next-auth/next";
import { authOptions, isSupervisor } from "@/lib/auth";
import { subscribeLiveEvents } from "@/lib/liveEvents";

// GET /api/analytics/stream — Server-Sent Events. Pushes a small "something
// changed" message (never the actual chart data — the client just refetches
// /api/analytics on receipt, same query it already knows how to run) whenever
// a call is logged, a task completes, a worker is added, or a contact gets
// assigned. See src/lib/liveEvents.js for the in-process broadcaster and
// src/components/AnalyticsPanel.jsx for the client side.
//
// This is a best-effort accelerant, not the only way data gets fresh: the
// client also runs a 60s safety-net poll (see useLiveAnalytics) in case
// Hostinger's CDN/proxy layer buffers or drops this long-lived connection —
// unconfirmed on this host, so the app must work correctly even if every SSE
// message here is silently lost.
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 20000;

export async function GET(req) {
  const session = await getServerSession(authOptions);
  if (!session || !isSupervisor(session)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let unsubscribe = () => {};
  let heartbeat;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (obj) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // Controller already closed (client disconnected between events) — ignore.
        }
      };

      unsubscribe = subscribeLiveEvents((evt) => send(evt));
      // Keeps the connection alive through any intermediary proxy/CDN idle
      // timeout, and doubles as a liveness signal the client can watch for.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch {}
      });
    },
    cancel() {
      clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Ask any nginx-style reverse proxy in front of the app not to buffer
      // this response — harmless no-op if Hostinger's layer ignores it.
      "X-Accel-Buffering": "no",
    },
  });
}
