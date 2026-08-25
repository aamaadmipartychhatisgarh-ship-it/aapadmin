"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Network, Users as UsersIcon, ChevronRight, MapPin, Phone } from "lucide-react";
import SupervisorGuard from "@/components/SupervisorGuard";
import PageHeader from "@/components/PageHeader";
import Avatar from "@/components/Avatar";

const LEVELS = [
  { key: "state", label: "State" },
  { key: "zone", label: "Zone" },
  { key: "lok_sabha", label: "Lok Sabha" },
  { key: "district", label: "District" },
  { key: "assembly", label: "Assembly" },
  { key: "block", label: "Block" },
];

export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

function Body() {
  const [level, setLevel] = useState("district");
  const [designationId, setDesignationId] = useState("");
  const [designations, setDesignations] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState({}); // group name → expanded

  // Designation master — live list (no hardcoding).
  useEffect(() => {
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(d.designations || [])).catch(() => {});
  }, []);

  // Re-fetch whenever the chosen level or designation changes — so the page
  // always reflects current Contacts + Master Data.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const p = new URLSearchParams({ level });
    if (designationId) p.set("designation_id", designationId);
    fetch(`/api/contacts/hierarchy?${p}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [level, designationId]);

  const isState = level === "state";
  const groups = data?.groups || [];
  const stateDesignations = data?.designations || [];
  const total = data?.total || 0;
  const levelLabel = LEVELS.find((l) => l.key === level)?.label || level;

  const inp = "h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 outline-none focus:border-[#164FA3] focus:ring-1 focus:ring-[#164FA3]";

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={Network}
        title="Designation Hierarchy"
        description="View people designation-wise, grouped by a geographic level — live from Contacts and the Designation master."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Contacts", href: "/dashboard/admin/contacts" }, { label: "Designation Hierarchy" }]}
      />

      {/* Controls: geographic level + designation */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Geographic Level</label>
          <select className={inp} value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Designation</label>
          <select className={inp} value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
            <option value="">All designations</option>
            {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="ml-auto text-sm text-gray-500">
          {loading ? <span className="inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Loading…</span>
            : isState
            ? <span><strong className="text-gray-900">{stateDesignations.length}</strong> designation{stateDesignations.length === 1 ? "" : "s"} · <strong className="text-gray-900">{total.toLocaleString()}</strong> assigned</span>
            : <span><strong className="text-gray-900">{total.toLocaleString()}</strong> {total === 1 ? "person" : "people"} · <strong className="text-gray-900">{groups.length}</strong> {levelLabel}{groups.length === 1 ? "" : "s"}</span>}
        </div>
      </div>

      {data?.capped && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-2.5 text-sm">
          Showing the first {total.toLocaleString()} people — narrow by designation or a lower level to see the rest.
        </div>
      )}

      {/* STATE level (PROMPT 7) — designation-wise matrix: each designation with
          its assigned people (Name + Photo ONLY); unassigned = blank. */}
      {isState ? (
        loading ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>
        ) : stateDesignations.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-gray-400">No designations configured.</div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
              <MapPin size={16} className="text-[#164FA3]" />
              <span className="font-bold text-gray-900">{data?.state_name || "State"}</span>
              <span className="text-xs text-gray-400">— designations at the State level</span>
            </div>
            <DesignationMatrix designations={stateDesignations} />
          </div>
        )
      ) : loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-gray-400">
          No {levelLabel.toLowerCase()}s to show for this selection.
        </div>
      ) : (
        // Per-location designation matrix (PROMPT 8+): one collapsible card per
        // location; each shows every designation with its assigned people or blank.
        <div className="space-y-3">
          {groups.map((g) => {
            const count = g.designations.reduce((s, d) => s + d.people.length, 0);
            const expanded = open[g.id] ?? groups.length <= 4;
            return (
              <div key={g.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <button
                  onClick={() => setOpen((o) => ({ ...o, [g.id]: !expanded }))}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left"
                >
                  <ChevronRight size={16} className={`text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`} />
                  <MapPin size={16} className="text-[#164FA3]" />
                  <span className="font-bold text-gray-900">{levelLabel}: {g.name}</span>
                  <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-gray-500 bg-gray-100 rounded-full px-2.5 py-1">
                    <UsersIcon size={12} /> {count} assigned
                  </span>
                </button>
                {expanded && <div className="border-t border-gray-100"><DesignationMatrix designations={g.designations} /></div>}
              </div>
            );
          })}
        </div>
      )}

      <div className="text-xs text-gray-400">
        <Link href="/dashboard/admin/contacts" className="hover:underline">← Back to Contacts</Link>
      </div>
    </div>
  );
}

// Designation → Person(s) rows. Assigned = Avatar + Name ONLY (no phone/address/
// status/etc.). Unassigned = the designation with a blank "— not assigned —".
function DesignationMatrix({ designations }) {
  return (
    <div className="divide-y divide-gray-50">
      {designations.map((d) => (
        <div key={d.id} className="flex items-start gap-4 px-4 py-3">
          <div className="w-56 shrink-0 font-semibold text-gray-800 text-sm pt-1">{d.name}</div>
          <div className="flex-1 min-w-0">
            {d.people.length === 0 ? (
              <span className="text-xs text-gray-300 italic">— not assigned —</span>
            ) : (
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {d.people.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-2">
                    <Avatar name={p.person_name} src={p.photo_url} size={32} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3] text-[11px]" />
                    <span className="text-sm text-gray-900">{p.person_name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
