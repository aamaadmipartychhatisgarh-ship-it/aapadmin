"use client";

import { useEffect, useState, useRef } from "react";
import { UserPlus, UserMinus, Loader2, CheckCircle2 } from "lucide-react";
import FilterMultiSelect from "@/components/FilterMultiSelect";
import { normalizeRole, ROLES } from "@/lib/permissions";

// The contact-assignment/distribution system, extracted from the former
// Contacts page's "Distribute contacts across callers" panel — same state,
// same /api/contacts/bulk-distribute + /api/contacts/bulk-unassign calls,
// unchanged behavior. It no longer sits above a full contacts table (the
// Contacts page owns that now), so it carries its own compact scope filters
// and fetches just a lightweight count for the Pending/Pool display instead
// of a full contact list.
export default function ContactDistributionPanel() {
  const [users, setUsers] = useState([]); // callers
  const [zones, setZones] = useState([]);
  const [zoneId, setZoneId] = useState("");
  const [lokSabhas, setLokSabhas] = useState([]);
  const [lokSabhaId, setLokSabhaId] = useState("");
  const [districts, setDistricts] = useState([]);
  const [districtId, setDistrictId] = useState("");
  const [assemblies, setAssemblies] = useState([]);
  const [assemblyIds, setAssemblyIds] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [designationIds, setDesignationIds] = useState([]);
  const [filter, setFilter] = useState("pending"); // all | pending | done | assigned | pool
  const [total, setTotal] = useState(0);
  const [poolTotal, setPoolTotal] = useState(0);
  const [countLoading, setCountLoading] = useState(true);
  const [teams, setTeams] = useState([]);
  const [bulkTeam, setBulkTeam] = useState("");
  const [bulkCallers, setBulkCallers] = useState([]);
  const [bulkMode, setBulkMode] = useState("even"); // even | perCaller
  const [perCaller, setPerCaller] = useState(100);
  const [reassignOthers, setReassignOthers] = useState(true);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const loadSeq = useRef(0);

  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then((d) => setUsers((d.users || []).filter((u) => normalizeRole(u.role) === ROLES.CALLER)));
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || []));
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(d.designations || []));
    fetch("/api/teams").then((r) => r.json()).then((d) => setTeams(d.teams || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const url = zoneId ? `/api/locations?parent_id=${zoneId}` : "/api/locations?type=lok_sabha";
    fetch(url).then((r) => r.json()).then((d) => setLokSabhas((d.locations || []).filter((l) => l.type === "lok_sabha")));
    setLokSabhaId(""); setDistrictId(""); setAssemblyIds([]);
  }, [zoneId]);
  useEffect(() => {
    const url = lokSabhaId ? `/api/locations?parent_id=${lokSabhaId}` : "/api/locations?type=district";
    fetch(url).then((r) => r.json()).then((d) => setDistricts((d.locations || []).filter((l) => l.type === "district")));
    setDistrictId("");
  }, [lokSabhaId]);
  useEffect(() => {
    let url = null;
    if (districtId) url = `/api/locations?parent_id=${districtId}`;
    else if (lokSabhaId) url = `/api/locations?assemblies_of_lok_sabha=${lokSabhaId}`;
    if (url) fetch(url).then((r) => r.json()).then((d) => setAssemblies((d.locations || []).filter((l) => l.type === "assembly")));
    else setAssemblies([]);
    setAssemblyIds([]);
  }, [districtId, lokSabhaId]);

  // Lightweight counts for the scope currently selected — Pending/matching
  // count (page_size=1 so the query stays cheap; the endpoint always
  // computes `total` regardless of page size) and a separate Pool count.
  useEffect(() => { loadCounts(); }, [filter, zoneId, lokSabhaId, districtId, assemblyIds, designationIds]);
  async function loadCounts() {
    const seq = ++loadSeq.current;
    setCountLoading(true);
    const base = new URLSearchParams();
    if (zoneId) base.set("zone_id", zoneId);
    if (lokSabhaId) base.set("lok_sabha_id", lokSabhaId);
    if (districtId) base.set("district_id", districtId);
    if (assemblyIds.length) base.set("assembly_ids", assemblyIds.join(","));
    if (designationIds.length) base.set("designation_ids", designationIds.join(","));
    base.set("page_size", "1");

    const scoped = new URLSearchParams(base);
    if (filter !== "all") scoped.set("status", filter);
    const pool = new URLSearchParams(base);
    pool.set("status", "pool");

    const [scopedRes, poolRes] = await Promise.all([
      fetch(`/api/contacts?${scoped}`, { cache: "no-store" }),
      fetch(`/api/contacts?${pool}`, { cache: "no-store" }),
    ]);
    if (seq !== loadSeq.current) return;
    if (scopedRes.ok) setTotal((await scopedRes.json()).total ?? 0);
    if (poolRes.ok) setPoolTotal((await poolRes.json()).total ?? 0);
    setCountLoading(false);
  }

  async function loadTeamCallers(teamId) {
    setBulkTeam(teamId);
    if (!teamId) return;
    const r = await fetch(`/api/teams/${teamId}`);
    if (!r.ok) return;
    const d = await r.json();
    const callerIds = users.map((u) => u.id);
    const memberCallerIds = (d.members || [])
      .filter((m) => m.member_type === "user" && callerIds.includes(m.user_id))
      .map((m) => m.user_id);
    setBulkCallers(memberCallerIds);
    if (memberCallerIds.length === 0) setError("This team has no caller accounts as members. Add users to the team first.");
    else setError("");
  }

  function toggleBulkCaller(id) {
    setBulkCallers((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function bulkDistribute() {
    setMessage(""); setError("");
    if (bulkCallers.length === 0) { setError("Select at least one caller to distribute to."); return; }
    const names = bulkCallers.map((id) => users.find((u) => u.id === id)?.username).filter(Boolean).join(", ");
    const desc = bulkMode === "perCaller"
      ? `${perCaller} contacts each to ${bulkCallers.length} caller(s): ${names}`
      : `evenly across ${bulkCallers.length} caller(s): ${names}`;
    const desigNames = designations.filter((d) => designationIds.includes(d.id)).map((d) => d.name);
    const desigLabel = desigNames.length ? ` with designation ${desigNames.map((n) => `"${n}"`).join(", ")}` : "";
    const skipNote = filter === "pending" ? " (Already-called contacts are excluded — you're viewing Pending only.)" : "";
    if (!confirm(`Distribute ${filter !== "all" ? filter + " " : ""}contacts${districtId ? " in this district" : ""}${desigLabel} — ${desc}?${skipNote}`)) return;
    setBulkBusy(true);
    try {
      const r = await fetch("/api/contacts/bulk-distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caller_ids: bulkCallers,
          mode: bulkMode,
          per_caller: bulkMode === "perCaller" ? Number(perCaller) : undefined,
          status: filter,
          zone_id: zoneId || undefined,
          lok_sabha_id: lokSabhaId || undefined,
          district_id: districtId || undefined,
          assembly_ids: assemblyIds.length ? assemblyIds.join(",") : undefined,
          designation_ids: designationIds.length ? designationIds.join(",") : undefined,
          reassign: reassignOthers,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.message || "Distribute failed"); return; }
      const breakdown = Object.entries(d.per_caller_counts || {}).map(([u, n]) => `${u}: ${n}`).join(", ");
      const capNote = d.matched_total > d.assigned
        ? ` (${d.matched_total} contacts matched your filters; ${d.matched_total - d.assigned} weren't included because "N per caller" × callers is smaller than the match — raise the per-caller count or add callers to cover them all.)`
        : "";
      setMessage(`Distributed ${d.assigned} of ${d.matched_total} matching contacts — ${breakdown || "none matched"}.${capNote}`);
      loadCounts();
    } catch {
      setError("Distribute failed — network error.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkRecall() {
    setMessage(""); setError("");
    const target = bulkCallers.length > 0 ? `${bulkCallers.length} selected caller(s)` : "ALL callers";
    if (!confirm(`Remove assigned contacts from ${target}? Contacts stay in the database and return to the pool; completed calls are not touched.`)) return;
    setBulkBusy(true);
    try {
      const r = await fetch("/api/contacts/bulk-unassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caller_ids: bulkCallers }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.message || "Recall failed"); return; }
      setMessage(`Removed ${d.unassigned} contact(s) from ${target} — they are back in the pool.`);
      loadCounts();
    } catch {
      setError("Recall failed — network error.");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 flex items-center gap-2"><CheckCircle2 size={16} />{message}</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3">{error}</div>}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
        {/* Scope filters + live counts */}
        <div className="flex items-center gap-3 flex-wrap">
          <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
            <option value="">All zones</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          <select value={lokSabhaId} onChange={(e) => setLokSabhaId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
            <option value="">All Lok Sabhas</option>
            {lokSabhas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select value={districtId} onChange={(e) => setDistrictId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
            <option value="">All districts</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <FilterMultiSelect label="assemblies" items={assemblies} selected={assemblyIds} onChange={setAssemblyIds} disabled={!districtId && !lokSabhaId} disabledLabel="Pick Lok Sabha" />
          <FilterMultiSelect label="designations" items={designations} selected={designationIds} onChange={setDesignationIds} />
          <div className="flex gap-1 flex-wrap">
            {["all", "pending", "done", "assigned", "pool"].map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase ${filter === f ? "bg-[#164FA3] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{f}</button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap text-sm">
          <span className="flex items-center gap-1.5"><span className="font-bold text-[#164FA3] text-base">{countLoading ? "…" : total.toLocaleString()}</span> {filter !== "all" ? filter : "matching"} contacts</span>
          <span className="flex items-center gap-1.5 text-gray-500"><span className="font-bold text-gray-700 text-base">{countLoading ? "…" : poolTotal.toLocaleString()}</span> in pool (unassigned)</span>
        </div>

        {/* team shortcut */}
        {teams.length > 0 && (
          <div className="flex items-center gap-2">
            <select value={bulkTeam} onChange={(e) => loadTeamCallers(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
              <option value="">Pick callers from a team…</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <span className="text-xs text-gray-500">or pick callers individually below</span>
          </div>
        )}

        {/* caller multi-select */}
        <div className="flex flex-wrap gap-2">
          {users.length === 0 && <span className="text-xs text-gray-500">No callers exist yet. Create caller users first.</span>}
          {users.map((u) => {
            const on = bulkCallers.includes(u.id);
            return (
              <button key={u.id} onClick={() => toggleBulkCaller(u.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${on ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-600 border-gray-200 hover:border-[#164FA3]"}`}>
                {on ? "✓ " : ""}{u.username}
              </button>
            );
          })}
          {users.length > 1 && (
            <button onClick={() => setBulkCallers(bulkCallers.length === users.length ? [] : users.map((u) => u.id))}
              className="px-3 py-1.5 rounded-full text-xs font-medium text-[#164FA3] underline">
              {bulkCallers.length === users.length ? "clear all" : "select all"}
            </button>
          )}
        </div>

        {/* mode + action */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 bg-gray-50 rounded-lg border border-gray-200 p-1">
            <button onClick={() => setBulkMode("even")} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${bulkMode === "even" ? "bg-[#164FA3] text-white" : "text-gray-600"}`}>Split evenly</button>
            <button onClick={() => setBulkMode("perCaller")} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${bulkMode === "perCaller" ? "bg-[#164FA3] text-white" : "text-gray-600"}`}>N per caller</button>
          </div>
          {bulkMode === "perCaller" && (
            <input type="number" min="1" value={perCaller} onChange={(e) => setPerCaller(e.target.value)} className="h-9 w-24 px-3 rounded-lg border border-gray-200 text-sm" placeholder="per caller" />
          )}
          <button onClick={bulkDistribute} disabled={bulkBusy || bulkCallers.length === 0} className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-sm">
            {bulkBusy ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
            {bulkBusy ? "Distributing…" : bulkMode === "even"
              ? `Split evenly to ${bulkCallers.length || 0} caller(s)`
              : `Give ${perCaller || 0} each to ${bulkCallers.length || 0} caller(s)`}
          </button>
          <span className="text-xs text-gray-500">Already-called (Done) contacts are never reassigned.</span>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input type="checkbox" checked={reassignOthers} onChange={(e) => setReassignOthers(e.target.checked)} />
          Take contacts already assigned to other callers
          <span className="text-xs text-gray-400 font-normal">(off = only hand out unassigned pool)</span>
        </label>

        <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-gray-100">
          <button onClick={bulkRecall} disabled={bulkBusy} className="inline-flex items-center gap-2 bg-white border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 px-4 py-2 rounded-xl text-sm font-semibold">
            <UserMinus size={16} />
            {bulkCallers.length > 0 ? `Remove contacts from ${bulkCallers.length} selected caller(s)` : "Remove contacts from ALL callers"}
          </button>
          <span className="text-xs text-gray-500">Contacts go back to the pool — nothing is deleted from the database.</span>
        </div>
      </div>
    </div>
  );
}
