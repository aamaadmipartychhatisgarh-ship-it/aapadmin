"use client";

import { useEffect, useState, useMemo } from "react";
import { ChevronDown, Check, Search, Flag } from "lucide-react";
import Avatar from "@/components/Avatar";

// One shared loader for the Party Master so every dropdown / logo on a page
// reads the SAME live list (and therefore the SAME current logos). Fetches
// /api/parties once per mount.
export function usePartyMaster() {
  const [parties, setParties] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/parties")
      .then((r) => (r.ok ? r.json() : { parties: [] }))
      .then((d) => { if (alive) setParties(d.parties || []); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  const byName = useMemo(() => {
    const m = new Map();
    for (const p of parties) m.set(String(p.name).trim().toLowerCase(), p);
    return m;
  }, [parties]);
  return { parties, byName, loading };
}

// Resolve a party's current logo URL from the master by its stored NAME. Returns
// null when the name isn't in the master (e.g. a legacy free-text value with no
// matching party) — callers then show initials/placeholder.
export function partyLogoFor(byName, name) {
  if (!name) return null;
  const p = byName?.get(String(name).trim().toLowerCase());
  return p?.logo_url || null;
}

// Small inline party logo + name, for read-only views (Full View, search cards).
// The logo is looked up live from the master, so a logo change in Party Master
// shows here immediately.
export function PartyLogo({ name, byName, size = 20 }) {
  if (!name) return <span className="text-gray-400">—</span>;
  const src = partyLogoFor(byName, name);
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={name} src={src} size={size} square className="bg-gray-100 border border-gray-200" textClassName="text-gray-500 text-[9px]" />
      <span className="truncate">{name}</span>
    </span>
  );
}

// Self-contained read-only party badge (logo + name) that loads the master
// itself — for one-off displays where threading a shared list isn't worth it.
// Prefer PartyLogo(byName) inside lists to avoid one fetch per row.
export function PartyBadge({ name, size = 18 }) {
  const { byName } = usePartyMaster();
  if (!name) return <span className="text-gray-400">—</span>;
  return <PartyLogo name={name} byName={byName} size={size} />;
}

const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-[#164FA3]/30";

// Searchable single-select bound to the Party Master. `value` is the party NAME
// (string; "" = none) so existing free-text party columns keep working, and
// `onChange(name)` fires the chosen master name. Shows each party's logo. Pass
// `parties` to reuse a page-level list, or omit to let it load its own.
export default function PartySelect({ value, onChange, parties: passedParties, placeholder = "Select a party", allowClear = true }) {
  const own = usePartyMaster();
  const parties = passedParties || own.parties;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = parties.find((p) => String(p.name).trim().toLowerCase() === String(value || "").trim().toLowerCase());
  const label = value || "";
  const ql = q.trim().toLowerCase();
  const list = parties.filter((p) => !ql || p.name.toLowerCase().includes(ql));

  return (
    <div className="relative w-full">
      <button type="button" onClick={() => { setOpen((o) => !o); setQ(""); }} className={`${inp} flex items-center justify-between gap-2 text-left`}>
        <span className="flex items-center gap-2 min-w-0">
          {selected ? (
            <Avatar name={selected.name} src={selected.logo_url} size={20} square className="bg-gray-100 border border-gray-200" textClassName="text-gray-500 text-[9px]" />
          ) : (
            <Flag size={14} className="text-gray-300 shrink-0" />
          )}
          <span className={label ? "text-gray-800 truncate" : "text-gray-400"}>{label || placeholder}</span>
        </span>
        <ChevronDown size={15} className="text-gray-400 shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute z-[61] mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
            <div className="p-2 sticky top-0 bg-white border-b border-gray-100">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parties…" className={`${inp} text-sm py-1.5 pl-8`} />
              </div>
            </div>
            {allowClear && (
              <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:bg-gray-50">— None —</button>
            )}
            {list.length === 0 ? (
              <div className="px-3 py-3 text-sm text-gray-400">{own.loading ? "Loading parties…" : "No parties in the master yet. Add them under Administration → Party Master."}</div>
            ) : list.map((p) => (
              <button key={p.id} type="button" onClick={() => { onChange(p.name); setOpen(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2 ${selected?.id === p.id ? "bg-blue-50/60 font-semibold text-[#164FA3]" : "text-gray-700"}`}>
                <Avatar name={p.name} src={p.logo_url} size={22} square className="bg-gray-100 border border-gray-200 shrink-0" textClassName="text-gray-500 text-[9px]" />
                <span className="truncate flex-1">{p.name}</span>
                {selected?.id === p.id && <Check size={14} className="text-[#164FA3] shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
