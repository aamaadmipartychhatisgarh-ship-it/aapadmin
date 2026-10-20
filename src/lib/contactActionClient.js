// Client helpers for "communication action initiated" tracking on registration lists.

// Fire-and-forget POST that survives the page handing off to the dialer / SMS app
// (keepalive). Resolves to the JSON response, or null on failure.
export async function postContactAction(url, body) {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true });
    return r.ok ? await r.json().catch(() => ({})) : null;
  } catch { return null; }
}

// "Call · 20 Oct, 10:30" for the latest initiated action (null when none).
export function contactActionText(action, at, names = {}) {
  if (!action || !at) return null;
  const label = { call: names.call || "Call", sms: names.sms || "SMS", whatsapp: names.whatsapp || "WhatsApp" }[action] || action;
  const d = new Date(String(at).replace(" ", "T"));
  const when = Number.isNaN(d.getTime()) ? String(at) : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return `${label} · ${when}`;
}
