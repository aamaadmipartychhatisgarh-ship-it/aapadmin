"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert, CheckCircle2, KeyRound } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { roleOf, ROLES } from "@/lib/permissions";

// Super-Admin settings for the OTP integrations. Lets the Firebase Phone Auth
// web config (and, if ever needed, the SMS provider) be entered from the browser
// and stored in app_settings — no SSH/scripts. The public registration form
// reads this live, so a save takes effect on the next form load.
export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();
  if (status === "loading") {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  if (status === "unauthenticated" || !session) { router.push("/login"); return null; }
  if (roleOf(session) !== ROLES.SUPER_ADMIN) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Integrations" />
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
          <ShieldAlert size={18} /> This page is available to Super Admin only.
        </div>
      </div>
    );
  }
  return <Body />;
}

function Field({ label, value, onChange, placeholder, hint }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
             className="mt-1 w-full h-11 rounded-lg border border-gray-300 px-3 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
      {hint ? <span className="mt-1 block text-[12px] text-gray-400">{hint}</span> : null}
    </label>
  );
}

function Body() {
  const [fb, setFb] = useState({ apiKey: "", authDomain: "", projectId: "", appId: "", messagingSenderId: "" });
  const [configured, setConfigured] = useState(false);
  const [missing, setMissing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true); setErr("");
    try {
      const r = await fetch("/api/admin/integrations");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || "Could not load settings."); return; }
      setFb({
        apiKey: d.firebase?.apiKey || "", authDomain: d.firebase?.authDomain || "",
        projectId: d.firebase?.projectId || "", appId: d.firebase?.appId || "",
        messagingSenderId: d.firebase?.messagingSenderId || "",
      });
      setConfigured(Boolean(d.firebase?.configured));
      setMissing(d.firebase?.missing || []);
    } catch { setErr("Could not load settings."); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save(e) {
    e?.preventDefault?.();
    setSaving(true); setErr(""); setMsg("");
    try {
      const r = await fetch("/api/admin/integrations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firebase: fb }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || "Could not save."); return; }
      setConfigured(Boolean(d.firebaseConfigured));
      setMissing(d.missing || []);
      setMsg(d.firebaseConfigured
        ? "Saved. Firebase Phone Auth is now configured — reload the registration link to use it."
        : `Saved. Still missing: ${(d.missing || []).join(", ")}.`);
    } catch { setErr("Could not save."); } finally { setSaving(false); }
  }

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Integrations" description="OTP / Phone verification" />

      <div className={`mt-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${configured ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
        {configured ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
        {configured
          ? "Firebase Phone Authentication is configured."
          : `Firebase is not fully configured${missing.length ? ` — missing: ${missing.join(", ")}` : ""}.`}
      </div>

      <form onSubmit={save} className="mt-5 space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-gray-900 font-semibold"><KeyRound size={18} /> Firebase Web Config</div>
        <p className="-mt-2 text-[13px] text-gray-500">
          From Firebase Console → Project settings → General → Your apps → Web app → SDK config.
          These values are not secret (they run in the browser). Also enable the Phone provider and add
          <span className="font-medium"> aapchhattisgarh.in</span> to Authentication → Settings → Authorized domains.
        </p>
        <Field label="apiKey" value={fb.apiKey} onChange={(v) => setFb((s) => ({ ...s, apiKey: v }))} placeholder="AIza…" />
        <Field label="authDomain" value={fb.authDomain} onChange={(v) => setFb((s) => ({ ...s, authDomain: v }))} placeholder="yourproject.firebaseapp.com" />
        <Field label="projectId" value={fb.projectId} onChange={(v) => setFb((s) => ({ ...s, projectId: v }))} placeholder="yourproject" />
        <Field label="appId" value={fb.appId} onChange={(v) => setFb((s) => ({ ...s, appId: v }))} placeholder="1:123…:web:abc…" />
        <Field label="messagingSenderId" value={fb.messagingSenderId} onChange={(v) => setFb((s) => ({ ...s, messagingSenderId: v }))} placeholder="123456789 (optional)" hint="Optional." />

        {err ? <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p> : null}
        {msg ? <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{msg}</p> : null}

        <button type="submit" disabled={saving} className="min-h-[46px] rounded-xl px-5 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60" style={{ background: "#164FA3" }}>
          {saving ? <Loader2 className="animate-spin" size={18} /> : null} Save configuration
        </button>
      </form>
    </div>
  );
}
