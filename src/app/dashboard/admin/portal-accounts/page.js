"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { UserCog, Loader2, KeyRound, Check, Search, UserPlus, X } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { isTopAdmin } from "@/lib/permissions";
import { usePageGuard } from "@/components/usePageGuard";

// Admin console: auto-provision login accounts for every eligible designation-holder
// (up to Vidhansabha). Shows who is eligible, who already has an account, and — after
// provisioning — the generated User IDs. Passwords are never shown (the default is
// the fixed '#', set server-side).
export default function PortalAccountsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { ready, allowed } = usePageGuard("portal_accounts", isTopAdmin(session));

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await fetch("/api/portal/provision", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr([d.message, d.detail].filter(Boolean).join(" — ")); return; }
      setData(d);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  async function provision() {
    if (!window.confirm("Create login accounts for all eligible members who don't have one yet?")) return;
    setRunning(true); setErr(""); setResult(null);
    try {
      const r = await fetch("/api/portal/provision", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr([d.message, d.detail].filter(Boolean).join(" — ")); return; }
      setResult(d);
      load();
    } finally { setRunning(false); }
  }

  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  const people = (data?.people || []).filter((p) => {
    const needle = q.trim().toLowerCase();
    return !needle || String(p.name || "").toLowerCase().includes(needle) || String(p.phone || "").includes(needle) || String(p.username || p.would_be_user_id || "").toLowerCase().includes(needle);
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={UserCog}
        title="Member Accounts"
        description="Login accounts for designation-holders up to Vidhansabha (State, Lok Sabha, District, Assembly). Block and member-level designations are excluded."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Administration", href: "/dashboard/admin/administration" }, { label: "Member Accounts" }]}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <SumCard label="Eligible members" value={data?.eligible ?? "—"} accent />
        <SumCard label="With an account" value={data?.with_account ?? "—"} />
        <SumCard label="Need an account" value={data ? data.eligible - data.with_account : "—"} />
      </div>

      {/* One-person creation form — same rules as bulk provisioning (server-enforced). */}
      <CreateMemberAccount onCreated={load} />

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / phone / User ID…"
            className="w-full pl-9 h-10 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
        </div>
        <button onClick={provision} disabled={running} className="bg-[#FCB712] text-[#164FA3] px-4 py-2 rounded-lg font-bold hover:bg-yellow-500 disabled:opacity-50 inline-flex items-center gap-2">
          {running ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Create accounts
        </button>
      </div>

      {err && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">{err}</div>}
      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm">
          <div className="font-semibold text-emerald-800 mb-1">Created {result.created.length} account(s). Default password is <span className="font-mono">#</span>.</div>
          {result.created.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {result.created.map((c) => (
                <span key={c.username} className="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded-md px-2 py-1 text-xs">
                  <Check size={12} className="text-emerald-600" /> <span className="font-semibold">{c.name}</span> → <span className="font-mono">{c.username}</span>
                </span>
              ))}
            </div>
          )}
          {result.skipped?.length > 0 && <div className="text-xs text-gray-500 mt-2">{result.skipped.length} skipped (already have an account or missing name/phone).</div>}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400"><Loader2 className="inline animate-spin text-[#164FA3]" /></div>
        ) : people.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No eligible members found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500 bg-gray-50">
                {["Name", "Phone", "Designations", "User ID", "Account"].map((h) => <th key={h} className="px-4 py-2 font-semibold whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.contact_id} className="border-t border-gray-100 hover:bg-gray-50/60">
                    <td className="px-4 py-2.5 font-semibold text-gray-900">{p.name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-600 whitespace-nowrap">{p.phone || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600 max-w-[280px]"><span className="line-clamp-2">{p.designations || "—"}</span></td>
                    <td className="px-4 py-2.5 font-mono text-xs">{p.username || p.would_be_user_id || "—"}</td>
                    <td className="px-4 py-2.5">
                      {p.username
                        ? <span className="text-[11px] font-semibold px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">Has account</span>
                        : <span className="text-[11px] font-semibold px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200">No account</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SumCard({ label, value, accent }) {
  return (
    <div className={`${accent ? "bg-[#164FA3] text-white" : "bg-white border border-gray-100"} rounded-xl p-4 shadow-sm`}>
      <div className={`text-2xl font-bold ${accent ? "" : "text-gray-900"}`}>{value}</div>
      <div className={`text-xs font-medium mt-1 ${accent ? "text-blue-200" : "text-gray-500"}`}>{label}</div>
    </div>
  );
}

const inp = "w-full h-10 rounded-lg border border-gray-200 px-3 text-sm bg-white outline-none focus:ring-2 focus:ring-[#164FA3] disabled:bg-gray-50 disabled:text-gray-400";
const lbl = "block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1";

// Preview of the server's User ID rule (first 2 letters, uppercased + last 6
// digits). The server recomputes it on save — this is display only.
function previewUserId(name, phone) {
  const letters = String(name || "").match(/\p{L}/gu) || [];
  const digits = String(phone || "").replace(/\D/g, "");
  if (letters.length < 2 || digits.length < 6) return "";
  return letters.slice(0, 2).join("").toUpperCase() + digits.slice(-6);
}

// User Creation / Access Form: creates ONE member login for a designation-holder
// up to Vidhansabha. Designation choices come from the API (eligible levels only,
// so Member/Block never appear); the User ID is generated, never typed; the
// password is the fixed '#' (set server-side, never echoed back as data).
function CreateMemberAccount({ onCreated }) {
  const blank = { name: "", phone: "", designation_id: "", zone_id: "", lok_sabha_id: "", district_id: "", assembly_id: "" };
  const [form, setForm] = useState(blank);
  const [designations, setDesignations] = useState([]);
  const [pages, setPages] = useState([]);
  const [zones, setZones] = useState([]);
  const [lokSabhas, setLokSabhas] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    fetch("/api/portal/accounts", { cache: "no-store" }).then((r) => r.json()).then((d) => { setDesignations(d.designations || []); setPages(d.pages || []); }).catch(() => {});
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || [])).catch(() => {});
  }, []);
  // Geography cascade (same loader the Contacts form uses); changing an upper
  // level clears everything below it.
  useEffect(() => {
    const url = form.zone_id ? `/api/locations?parent_id=${form.zone_id}` : "/api/locations?type=lok_sabha";
    fetch(url).then((r) => r.json()).then((d) => setLokSabhas((d.locations || []).filter((l) => l.type === "lok_sabha"))).catch(() => {});
  }, [form.zone_id]);
  useEffect(() => {
    const url = form.lok_sabha_id ? `/api/locations?parent_id=${form.lok_sabha_id}` : "/api/locations?type=district";
    fetch(url).then((r) => r.json()).then((d) => setDistricts((d.locations || []).filter((l) => l.type === "district"))).catch(() => {});
  }, [form.lok_sabha_id]);
  useEffect(() => {
    if (!form.district_id) return;
    fetch(`/api/locations?parent_id=${form.district_id}`).then((r) => r.json()).then((d) => setAssemblies((d.locations || []).filter((l) => l.type === "assembly"))).catch(() => {});
  }, [form.district_id]);
  // No district selected → no assembly choices (derived, so no state reset needed).
  const assemblyOptions = form.district_id ? assemblies : [];

  const preview = previewUserId(form.name, form.phone);
  const canSubmit = form.name.trim().length >= 2 && form.phone.replace(/\D/g, "").length >= 10 && !!form.designation_id && !saving;

  // Group the dropdown by level so the admin sees the hierarchy at a glance.
  const levelLabel = { state: "State", lok_sabha: "Lok Sabha", district: "District", assembly: "Assembly / Vidhansabha" };
  const groups = ["state", "lok_sabha", "district", "assembly"].map((lv) => ({ lv, items: designations.filter((d) => d.level === lv) })).filter((g) => g.items.length);

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true); setError(""); setDone(null);
    try {
      const r = await fetch("/api/portal/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name, phone: form.phone, designation_ids: [Number(form.designation_id)],
          zone_id: form.zone_id || null, lok_sabha_id: form.lok_sabha_id || null, district_id: form.district_id || null, assembly_id: form.assembly_id || null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError([d.message, d.detail].filter(Boolean).join(" — ") || "Could not create the account."); return; }
      setDone(d);
      setForm(blank);
      onCreated?.();
    } finally { setSaving(false); }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2 text-[#164FA3]">
        <UserPlus size={18} />
        <h2 className="font-bold text-base">Create Member Account</h2>
        <span className="ml-auto text-xs text-gray-500 hidden sm:inline">State · Lok Sabha · District · Assembly level only</span>
      </div>
      <form onSubmit={submit} className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={lbl} htmlFor="ma-name">Full name</label>
            <input id="ma-name" className={inp} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Rahul Singh" required />
          </div>
          <div>
            <label className={lbl} htmlFor="ma-phone">Mobile number</label>
            <input id="ma-phone" className={inp} value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit mobile" inputMode="numeric" required />
          </div>
          <div>
            <label className={lbl} htmlFor="ma-desig">Designation</label>
            <select id="ma-desig" className={inp} value={form.designation_id} onChange={(e) => set("designation_id", e.target.value)} required>
              <option value="">Select designation…</option>
              {groups.map((g) => (
                <optgroup key={g.lv} label={levelLabel[g.lv]}>
                  {g.items.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className={lbl} htmlFor="ma-zone">Zone</label>
            <select id="ma-zone" className={inp} value={form.zone_id} onChange={(e) => setForm((f) => ({ ...f, zone_id: e.target.value, lok_sabha_id: "", district_id: "", assembly_id: "" }))}>
              <option value="">Any</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="ma-ls">Lok Sabha</label>
            <select id="ma-ls" className={inp} value={form.lok_sabha_id} onChange={(e) => setForm((f) => ({ ...f, lok_sabha_id: e.target.value, district_id: "", assembly_id: "" }))}>
              <option value="">Any</option>{lokSabhas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="ma-dist">District</label>
            <select id="ma-dist" className={inp} value={form.district_id} onChange={(e) => setForm((f) => ({ ...f, district_id: e.target.value, assembly_id: "" }))}>
              <option value="">Any</option>{districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="ma-asm">Assembly</label>
            <select id="ma-asm" className={inp} value={form.assembly_id} onChange={(e) => set("assembly_id", e.target.value)} disabled={!form.district_id}>
              <option value="">Any</option>{assemblyOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 text-sm">
          <div><span className="text-gray-500">User ID:</span> <span className="font-mono font-semibold text-gray-900">{preview || "— (needs name + phone)"}</span></div>
          <div><span className="text-gray-500">Password:</span> <span className="font-mono font-semibold text-gray-900">#</span></div>
          <div className="text-gray-500">Access: <span className="text-gray-700 font-medium">Dashboard · Announcements · Worker Approval</span></div>
          <div className="text-xs text-gray-400 w-full">The User ID is generated automatically (first two letters of the name + last six digits of the mobile). If it is already taken a number is appended, and existing accounts are never changed.</div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm flex items-start gap-2"><X size={14} className="mt-0.5 shrink-0" />{error}</div>}
        {done && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800 flex flex-wrap items-center gap-2">
            <Check size={14} />
            <span>Account created for <strong>{done.name}</strong>{done.reused_contact ? " (linked to their existing contact record)" : ""}.</span>
            <span>User ID <span className="font-mono font-bold">{done.username}</span>, password <span className="font-mono font-bold">#</span>.</span>
            <span className="text-xs text-emerald-700">Pages: {(done.pages || pages).join(", ")}</span>
          </div>
        )}

        <div className="flex justify-end">
          <button type="submit" disabled={!canSubmit} className="bg-[#FCB712] text-[#164FA3] px-5 py-2 rounded-lg font-bold hover:bg-yellow-500 disabled:opacity-50 inline-flex items-center gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />} Create account
          </button>
        </div>
      </form>
    </div>
  );
}
