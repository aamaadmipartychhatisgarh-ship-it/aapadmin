"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare, Save, Shield } from "lucide-react";
import { normalizeRole, ROLES } from "@/lib/permissions";

// Super-Admin-only OTP settings. One provider: 2Factor.
//
// This page exists so the SMS credentials can be set without touching the host's
// environment variables — on this host that API is a full replace over masked
// values, where one wrong entry breaks admin login for everyone.
//
// The API key is write-only here. It is never returned by the backend, so the
// field always renders empty and a blank save leaves the stored key untouched.
const BRAND = "#164FA3";
const card = "bg-white border border-gray-200 rounded-2xl shadow-sm";
const input =
  "w-full h-11 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 " +
  "focus:outline-none focus:ring-2 focus:ring-[#164FA3] focus:border-transparent";

export default function IntegrationsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const isSuper = normalizeRole(session?.user?.role) === ROLES.SUPER_ADMIN;

  const [state, setState] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/integrations", { cache: "no-store" });
      if (!r.ok) { setErr("Could not load OTP settings."); return; }
      const d = await r.json();
      setState(d.sms || null);
      setTemplate(d.sms?.template || "");
    } catch { setErr("Could not load OTP settings."); }
  }, []);

  useEffect(() => { if (isSuper) load(); }, [isSuper, load]);

  async function save() {
    setBusy(true); setMsg(""); setErr("");
    try {
      const r = await fetch("/api/admin/integrations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sms: { apiKey, template } }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d?.message || "Could not save."); return; }
      setApiKey("");   // never keep a secret in a live field
      setMsg(d.savedKeys?.length ? `Saved: ${d.savedKeys.join(", ")}` : "Nothing to save — both fields were blank.");
      load();
    } catch { setErr("Could not save."); }
    finally { setBusy(false); }
  }

  if (status === "loading") {
    return <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin" style={{ color: BRAND }} size={28} /></div>;
  }
  if (!isSuper) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center">
        <div className={`${card} max-w-md w-full p-8 text-center`}>
          <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4"><Shield size={26} /></div>
          <h2 className="text-lg font-bold text-gray-900">Access Denied</h2>
          <p className="text-sm text-gray-500 mt-2">OTP settings are restricted to the Super Admin.</p>
          <button onClick={() => router.push("/dashboard")} className="mt-6 h-10 px-5 rounded-lg text-white text-sm font-semibold" style={{ background: BRAND }}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  const bal = state?.balance;
  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ background: BRAND }}><MessageSquare size={22} /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">OTP / SMS</h1>
          <p className="text-sm text-gray-500">Mobile verification via 2Factor · Super Admin only</p>
        </div>
      </div>

      <div className={`${card} p-5 space-y-4`}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`px-2 py-1 rounded-md font-semibold ${state?.keySet ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {state?.keySet ? `API key set (${state.keyFrom})` : "No API key — OTP is unavailable"}
          </span>
          {state?.keySet ? (
            <span className={`px-2 py-1 rounded-md font-semibold ${
              bal === null ? "bg-gray-100 text-gray-600" : bal <= 50 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
              {bal === null ? "balance unknown" : `${bal} SMS credits left`}
            </span>
          ) : null}
          {state?.template ? <span className="px-2 py-1 rounded-md bg-gray-100 text-gray-600">template: {state.template}</span> : null}
        </div>

        <label className="block">
          <span className="block text-sm font-semibold text-gray-800 mb-1.5">2Factor API key</span>
          <input className={input} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                 placeholder={state?.keySet ? "•••••••• (leave blank to keep the current key)" : "Paste the API key from 2factor.in"}
                 autoComplete="off" />
          <span className="block text-xs text-gray-500 mt-1">
            Write-only: the saved key is never shown again. Leaving this blank keeps whatever is stored.
          </span>
        </label>

        <label className="block">
          <span className="block text-sm font-semibold text-gray-800 mb-1.5">OTP template name</span>
          <input className={input} value={template} onChange={(e) => setTemplate(e.target.value)}
                 placeholder="e.g. AAPCGREG" autoComplete="off" />
          <span className="block text-xs text-gray-500 mt-1">
            The approved template from 2Factor → SMS OTP → OTP Templates. Without it the provider sends under its
            own default header.
          </span>
        </label>

        {msg ? <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2">{msg}</p> : null}
        {err ? <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{err}</p> : null}

        <div className="flex justify-end">
          <button onClick={save} disabled={busy}
                  className="h-10 px-5 rounded-lg text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60"
                  style={{ background: BRAND }}>
            {busy ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}Save
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-3">
        Environment variables take precedence over anything saved here, so a host that sets
        <code className="mx-1 px-1 bg-gray-100 rounded">TWOFACTOR_API_KEY</code> is never overridden by this page.
      </p>
    </div>
  );
}
