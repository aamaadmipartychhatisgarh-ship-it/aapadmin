import { EventEmitter } from "events";

// In-process pub/sub for "something analytics-relevant just changed" signals.
// Deliberately NOT a message queue or external broker — this app runs as a
// single Node process on Hostinger's managed Node app hosting (see SETUP.md:
// "push to master, panel rebuilds and restarts"), so every request already
// lands in the same process. An EventEmitter is the entire mechanism needed
// to fan a mutation out to every open SSE connection (see
// src/app/api/analytics/stream/route.js) — no Redis/Pusher/etc required.
//
// Raised the default 10-listener cap: each open Analytics tab holds one
// listener for the life of its SSE connection, so more than a handful of
// concurrent viewers would otherwise print MaxListenersExceededWarning.
const emitter = new EventEmitter();
emitter.setMaxListeners(200);

export const LIVE_EVENTS = {
  CALL_LOGGED: "call.logged",
  WRONG_NUMBER_ADDED: "wrong_number.added",
  TASK_COMPLETED: "task.completed",
  WORKER_ADDED: "worker.added",
  CONTACT_ASSIGNED: "contact.assigned",
};

// Fire-and-forget — mutation routes call this right after their write
// succeeds. Never throws (a broadcast failing must never fail the request
// that triggered it) and never awaited by callers.
export function emitLiveEvent(type, payload = {}) {
  try {
    emitter.emit("event", { type, payload, at: new Date().toISOString() });
  } catch (err) {
    console.error("emitLiveEvent failed:", err);
  }
}

// Returns an unsubscribe function.
export function subscribeLiveEvents(listener) {
  emitter.on("event", listener);
  return () => emitter.off("event", listener);
}
