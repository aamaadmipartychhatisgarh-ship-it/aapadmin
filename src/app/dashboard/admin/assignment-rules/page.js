"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, CalendarClock, CheckCircle2, ToggleLeft, ToggleRight, ChevronRight, Users } from "lucide-react";
import { isAdmin, normalizeRole, ROLES } from "@/lib/permissions";

export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !isAdmin(session)) router.push("/dashboard");
  }, [status, session, router]);
  if (status !== "authenticated" || !isAdmin(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body />;
}

function Body() {
  const [rules, setRules] = useState([]);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [callers, setCallers] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const r = await fetch("/api/assignment-rules");
    if (r.ok) { const d = await r.json(); setRules(d.rules || []); setNeedsMigration(!!d.needs_migration); }
    setLoading(false);
  }
  useEffect(() => {
    load();
    fetch("/api/users").then((r) => r.json()).then((d) => setCallers((d.users || []).filter((u) => normalizeRole(u.role) === ROLES.CALLER)));
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(d.designations || []));
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || []));
  }, []);

  async function toggle(rule) {
    await fetch(`/api/assignment-rules/${rule.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: rule.is_active ? 0 : 1 }),
    });
    load();
  }
  async function remove(rule) {
    if (!confirm(`Delete the rule assigning ${rule.caller_name} their daily contacts?`)) return;
    await fetch(`/api/assignment-rules/${rule.id}`, { method: "DELETE" });
    load();
  }

  const desigName = (id) => designations.find((d) => d.id === id)?.name || `#${id}`;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Daily Assignments</h1>
        <p className="text-gray-500 mt-2 font-medium">
          Standing rules that keep a caller&apos;s queue topped up each day — e.g. give a caller all
          <span className="font-semibold text-gray-700"> Lok Sabha Prabhari</span> contacts in a district, up to a daily limit.
          Rules run when the caller opens their workspace: the queue is filled from the unassigned pool, and if it&apos;s still short of the quota, matching contacts are pulled from other callers.
        </p>
      </div>

      {needsMigration && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm">
          The database isn&apos;t set up for assignment rules yet. Run <code className="font-mono">node scripts/add-assignment-rules-schema.mjs</code> against the database to enable this feature.
        </div>
      )}
      {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 flex items-center gap-2 text-sm"><CheckCircle2 size={16} />{message}</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm">{error}</div>}

      <AddRuleForm callers={callers} designations={designations} zones={zones}
        onSaved={() => { setMessage("Rule added. It applies next time the caller opens their workspace."); load(); }}
        onError={setError} />

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center gap-2">
          <CalendarClock size={18} className="text-[#164FA3]" />
          <h2 className="font-bold text-gray-900">Active rules</h2>
        </div>
        {loading ? (
          <div className="p-8 text-gray-400">Loading…</div>
        ) : rules.length === 0 ? (
          <div className="p-8 text-gray-400">No rules yet. Add one above.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Caller</th>
                <th className="px-4 py-3 font-semibold">Matches</th>
                <th className="px-4 py-3 font-semibold text-right">Daily quota</th>
                <th className="px-4 py-3 font-semibold text-right">Stale after</th>
                <th className="px-4 py-3 font-semibold text-right">Pool now</th>
                <th className="px-4 py-3 font-semibold text-center">Active</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <RuleRow key={r.id} r={r} desigName={desigName} onToggle={toggle} onRemove={remove} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// One rule row + an expandable panel listing the contacts it covers (the
// caller's current daily set, and what's waiting in the pool for next top-up).
function RuleRow({ r, desigName, onToggle, onRemove }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  async function expand() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!data) {
      setLoading(true);
      const res = await fetch(`/api/assignment-rules/${r.id}/contacts`);
      if (res.ok) setData(await res.json());
      setLoading(false);
    }
  }

  return (
    <>
      <tr className="border-t border-gray-100 hover:bg-gray-50">
        <td className="px-4 py-3 font-semibold text-gray-900">{r.caller_name}</td>
        <td className="px-4 py-3 text-gray-600">
          {(r.designation_ids?.length ? r.designation_ids.map(desigName).join(", ") : "Any designation")}
          {(r.zone_id || r.lok_sabha_id || r.district_id || r.assembly_id) ? <span className="text-gray-400"> · scoped area</span> : <span className="text-gray-400"> · all areas</span>}
        </td>
        <td className="px-4 py-3 text-right font-bold text-gray-900">{r.daily_quota}</td>
        <td className="px-4 py-3 text-right text-gray-500">{r.stale_days}d</td>
        <td className="px-4 py-3 text-right text-gray-700">{r.pool_matches ?? "—"}</td>
        <td className="px-4 py-3 text-center">
          <button onClick={() => onToggle(r)} title={r.is_active ? "Active — click to pause" : "Paused — click to activate"}>
            {r.is_active ? <ToggleRight size={26} className="text-emerald-600" /> : <ToggleLeft size={26} className="text-gray-300" />}
          </button>
        </td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
          <button onClick={expand} className="inline-flex items-center gap-1 text-xs text-[#164FA3] hover:bg-blue-50 px-2 py-1 rounded-lg font-medium">
            <ChevronRight size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} /> Contacts
          </button>
          <button onClick={() => onRemove(r)} className="inline-flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg font-medium"><Trash2 size={14} /> Delete</button>
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50/60">
          <td colSpan={7} className="px-4 py-4">
            {loading ? (
              <div className="text-gray-400 text-sm flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading contacts…</div>
            ) : !data ? null : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <ContactList title={`Assigned now to ${r.caller_name}`} accent="emerald" rows={data.assigned} />
                <ContactList title="Waiting in pool (next top-up)" accent="amber" rows={data.pool} />
                <ContactList title="Held by other callers (will be pulled in)" accent="red" rows={data.others || []} showOwner />
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function ContactList({ title, accent, rows, showOwner }) {
  const dot = accent === "emerald" ? "bg-emerald-500" : accent === "red" ? "bg-red-500" : "bg-amber-500";
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="text-xs font-semibold text-gray-700">{title}</span>
        <span className="text-xs text-gray-400">({rows.length})</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-gray-400 py-2">None.</div>
      ) : (
        <ul className="space-y-1 max-h-56 overflow-y-auto">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center justify-between text-xs border-b border-gray-50 pb-1">
              <span className="font-medium text-gray-800">
                {c.person_name}
                {showOwner && c.owner_name ? <span className="ml-1 text-red-500">· {c.owner_name}</span> : null}
              </span>
              <span className="text-gray-400">{c.phone_number}{c.designation_name ? ` · ${c.designation_name}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddRuleForm({ callers, designations, zones, onSaved, onError }) {
  const [callerId, setCallerId] = useState("");
  const [desigIds, setDesigIds] = useState([]);
  const [zoneId, setZoneId] = useState("");
  const [lokSabhaId, setLokSabhaId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [assemblyId, setAssemblyId] = useState("");
  const [lokSabhas, setLokSabhas] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [quota, setQuota] = useState(100);
  const [staleDays, setStaleDays] = useState(3);
  const [saving, setSaving] = useState(false);

  // Cascade Zone → Lok Sabha → District → Assembly.
  useEffect(() => {
    const url = zoneId ? `/api/locations?parent_id=${zoneId}` : `/api/locations?type=lok_sabha`;
    fetch(url).then((r) => r.json()).then((d) => setLokSabhas((d.locations || []).filter((l) => l.type === "lok_sabha")));
    setLokSabhaId(""); setDistrictId(""); setAssemblyId("");
  }, [zoneId]);
  useEffect(() => {
    const url = lokSabhaId ? `/api/locations?parent_id=${lokSabhaId}` : `/api/locations?type=district`;
    fetch(url).then((r) => r.json()).then((d) => setDistricts((d.locations || []).filter((l) => l.type === "district")));
    setDistrictId(""); setAssemblyId("");
  }, [lokSabhaId]);
  useEffect(() => {
    if (!districtId) { setAssemblies([]); setAssemblyId(""); return; }
    fetch(`/api/locations?parent_id=${districtId}`).then((r) => r.json()).then((d) => setAssemblies((d.locations || []).filter((l) => l.type === "assembly")));
    setAssemblyId("");
  }, [districtId]);

  const toggleDesig = (id) => setDesigIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  async function save() {
    if (!callerId) { onError("Pick a caller for the rule."); return; }
    setSaving(true); onError("");
    try {
      const r = await fetch("/api/assignment-rules", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caller_user_id: Number(callerId),
          designation_ids: desigIds,
          zone_id: zoneId || null, lok_sabha_id: lokSabhaId || null,
          district_id: districtId || null, assembly_id: assemblyId || null,
          daily_quota: Number(quota), stale_days: Number(staleDays),
        }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); onError(d.message || "Could not add rule"); return; }
      setCallerId(""); setDesigIds([]); setZoneId(""); setQuota(100); setStaleDays(3);
      onSaved();
    } finally { setSaving(false); }
  }

  const sel = "h-10 px-3 rounded-lg border border-gray-200 text-sm bg-white";
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-2"><Plus size={18} className="text-[#164FA3]" /><h2 className="font-bold text-gray-900">New rule</h2></div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Caller *</label>
          <select value={callerId} onChange={(e) => setCallerId(e.target.value)} className={`${sel} w-full`}>
            <option value="">Select caller…</option>
            {callers.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Zone</label>
          <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className={`${sel} w-full`}>
            <option value="">All zones</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Lok Sabha</label>
          <select value={lokSabhaId} onChange={(e) => setLokSabhaId(e.target.value)} className={`${sel} w-full`}>
            <option value="">All Lok Sabhas</option>
            {lokSabhas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">District</label>
          <select value={districtId} onChange={(e) => setDistrictId(e.target.value)} className={`${sel} w-full`}>
            <option value="">All districts</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Assembly</label>
          <select value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)} disabled={!districtId} className={`${sel} w-full disabled:opacity-50`}>
            <option value="">{districtId ? "All assemblies" : "Pick district"}</option>
            {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Daily quota</label>
          <input type="number" min="1" value={quota} onChange={(e) => setQuota(e.target.value)} className={`${sel} w-full`} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Reclaim stale after (days)</label>
          <input type="number" min="1" value={staleDays} onChange={(e) => setStaleDays(e.target.value)} className={`${sel} w-full`} />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-2">Designations (leave empty for any)</label>
        <div className="flex flex-wrap gap-2">
          {designations.map((d) => {
            const on = desigIds.includes(d.id);
            return (
              <button key={d.id} type="button" onClick={() => toggleDesig(d.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${on ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-600 border-gray-200 hover:border-[#164FA3]"}`}>
                {on ? "✓ " : ""}{d.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving || !callerId} className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-md">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add rule
        </button>
      </div>
    </div>
  );
}
