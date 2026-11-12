"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, ChevronDown, Loader2, RefreshCw, MessageCircle, UserX, AlertTriangle } from "lucide-react";
import Avatar from "@/components/Avatar";
import { wingShortLabel } from "@/lib/wingLabel";

// Designation Vacancies — TREE MAP. State -> Lok Sabha -> District -> Assembly (every level the server sends), built
// from the live vacancy dataset (/api/vacancies/tree). Opens with State, Lok Sabha and District visible; a District
// (and anything below it) opens only when its own branch is expanded. Collapsed branches render nothing below their
// header, so a large organisation stays fast. Expansion state survives a refresh / Wing change (keyed by unit).

const BRAND = "#164FA3";
const MAIN_WING = "__main__";
const LEVEL_TONE = {
  state: "bg-[#164FA3] text-white",
  lok_sabha: "bg-indigo-50 text-indigo-700 border border-indigo-200",
  district: "bg-sky-50 text-sky-700 border border-sky-200",
  assembly: "bg-teal-50 text-teal-700 border border-teal-200",
  block: "bg-gray-50 text-gray-700 border border-gray-200",
};

function Counts({ c, compact }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px] font-semibold" data-testid="node-counts">
      <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700" title="Total designation posts">{compact ? "" : "Total "}<b data-testid="cnt-total">{c.total}</b></span>
      <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200" title="Filled posts">Filled <b data-testid="cnt-filled">{c.filled}</b></span>
      <span className={`px-2 py-0.5 rounded-full border ${c.vacant ? "bg-red-50 text-red-700 border-red-300" : "bg-gray-50 text-gray-400 border-gray-200"}`} title="Vacant posts">Vacant <b data-testid="cnt-vacant">{c.vacant}</b></span>
    </span>
  );
}

function FilledCard({ p }) {
  return (
    <div className="rounded-xl border border-green-200 bg-white p-3 flex flex-col gap-2 min-w-0" data-testid="post-filled" data-designation={p.designation_name}>
      <div className="text-[11px] font-semibold text-green-700 uppercase tracking-wide">Filled</div>
      {p.holders.map((h) => (
        <div key={h.contact_id} className="flex items-center gap-2.5 min-w-0" data-testid="post-holder">
          <Avatar name={h.name} src={h.photo_url} size={44} className="shrink-0 bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3] text-xs" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate" title={h.name} data-testid="holder-name">{h.name}</div>
            <div className="text-xs text-gray-700 truncate" title={p.designation_name}>{p.designation_name}</div>
            <div className="text-[11px] text-gray-500 truncate">{p.level === "state" ? p.level_label : `${p.level_label} · ${p.location_name}`}{p.wing ? ` · ${wingShortLabel(p.wing)}` : ""}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function VacantCard({ p }) {
  return (
    <div className="rounded-xl border-2 border-red-400 bg-red-50 p-3 flex flex-col gap-2 min-w-0" data-testid="post-vacant" data-designation={p.designation_name}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold text-white bg-red-600 rounded px-1.5 py-0.5 tracking-wide">VACANT</span>
        <span className="text-[11px] text-red-700 truncate">{p.level === "state" ? p.level_label : `${p.level_label} · ${p.location_name}`}{p.wing ? ` · ${wingShortLabel(p.wing)}` : ""}</span>
      </div>
      {/* The vacant POST (designation) — prominent, never mixed up with the proposed person below. */}
      <div className="text-sm font-bold text-red-700 break-words" data-testid="vacant-designation">{p.designation_name}</div>
      {p.needs_review && (
        <div className="flex items-start gap-1 text-[11px] text-amber-700" data-testid="vacant-review">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>Needs data check{p.review_people.length ? `: ${p.review_people.join(", ")} may hold it (location not set)` : ""}</span>
        </div>
      )}
      <div className="border-t border-red-200 pt-2">
        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Proposed person</div>
        {p.proposed.length === 0 ? (
          <div className="inline-flex items-center gap-1 text-xs text-gray-500 italic" data-testid="proposed-none"><UserX size={13} /> Person Not Assigned</div>
        ) : p.proposed.map((x) => (
          <div key={x.assignment_id} className="flex items-center gap-2 min-w-0 mb-1 last:mb-0" data-testid="proposed-person">
            <Avatar name={x.name} src={x.photo_url} size={28} className="shrink-0 bg-white border border-gray-200" textClassName="text-gray-600 text-[10px]" />
            <div className="min-w-0">
              {x.whatsapp_url ? (
                <a href={x.whatsapp_url} target="_blank" rel="noopener noreferrer" data-testid="proposed-whatsapp"
                  title={`WhatsApp ${x.name} about ${p.designation_name}`}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-[#128C4B] hover:underline max-w-full">
                  <MessageCircle size={13} className="shrink-0" /><span className="truncate">{x.name}</span>
                </a>
              ) : (
                <span className="text-sm font-semibold text-gray-800" data-testid="proposed-nolink">{x.name} <span className="text-[11px] font-normal text-gray-500">(no valid mobile)</span></span>
              )}
              <div className="text-[10px] text-gray-500 truncate">{x.stage_label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const TreeNode = memo(function TreeNode({ node, expanded, toggle, depth }) {
  const open = expanded.has(node.id);
  const hasBody = node.posts.length > 0 || node.children.length > 0;
  return (
    <div className={depth ? "relative pl-3 sm:pl-5 border-l-2 border-gray-200 ml-2 sm:ml-3" : ""} data-testid="tree-node" data-level={node.level} data-node={node.id}>
      <button type="button" onClick={() => hasBody && toggle(node.id)} aria-expanded={open} disabled={!hasBody}
        data-testid="node-toggle"
        className="w-full flex flex-wrap items-center gap-2 text-left py-2 px-2 rounded-lg hover:bg-gray-50 disabled:cursor-default">
        <span className="shrink-0 text-gray-500">{hasBody ? (open ? <ChevronDown size={18} /> : <ChevronRight size={18} />) : <span className="inline-block w-[18px]" />}</span>
        <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-md ${LEVEL_TONE[node.level] || LEVEL_TONE.block}`}>{node.level_label}</span>
        <span className="font-semibold text-gray-900 mr-1" data-testid="node-name">{node.name}</span>
        <Counts c={node.counts} />
      </button>
      {open && (
        <div className="pb-2">
          {node.posts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2.5 px-2 sm:px-3 py-2" data-testid="node-posts">
              {node.posts.map((p) => (p.status === "filled" ? <FilledCard key={p.key} p={p} /> : <VacantCard key={p.key} p={p} />))}
            </div>
          )}
          {node.children.map((c) => <TreeNode key={c.id} node={c} expanded={expanded} toggle={toggle} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
});

// Ids of every node above the District level (State, Lok Sabha) — the default open set, so Districts are visible
// but nothing below them is expanded.
function defaultOpen(root, levels) {
  const keys = levels.map((l) => l.key);
  const stop = keys.indexOf("district") >= 0 ? keys.indexOf("district") : 2;
  const out = new Set();
  const walk = (n) => { const i = keys.indexOf(n.level); if (n.level === "state" || (i >= 0 && i < stop)) { out.add(n.id); n.children.forEach(walk); } };
  walk(root);
  return out;
}
function allIds(root) { const out = new Set(); const walk = (n) => { out.add(n.id); n.children.forEach(walk); }; walk(root); return out; }

export default function VacancyTreeMap() {
  const [wing, setWing] = useState(MAIN_WING);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());
  const seeded = useRef(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true); setErr("");
    try {
      const qs = wing === "" ? "?wing=" : `?wing=${encodeURIComponent(wing)}`;
      const r = await fetch(`/api/vacancies/tree${qs}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (my !== seq.current) return;
      if (!r.ok) { setErr(d.message || "Could not load the Tree Map."); return; }
      setData(d);
      // Seed the State -> District view once; later loads keep whatever the user opened or closed.
      if (!seeded.current && d.tree) { seeded.current = true; setExpanded(defaultOpen(d.tree, d.levels || [])); }
    } catch { if (my === seq.current) setErr("Could not load the Tree Map."); }
    finally { if (my === seq.current) setLoading(false); }
  }, [wing]);
  useEffect(() => { load(); }, [load]);

  const toggle = useCallback((id) => setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);

  const c = data?.counts;
  return (
    <div className="bg-white border border-gray-200 rounded-xl" data-testid="vacancy-tree">
      <div className="px-3 sm:px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold text-gray-900 mr-2">Tree Map</h2>
        <select value={wing} onChange={(e) => setWing(e.target.value)} data-testid="tree-wing"
          className="h-9 rounded-lg border border-gray-200 text-sm px-2 text-gray-700 bg-white">
          {(data?.wings?.length ? data.wings : [{ key: MAIN_WING, label: "Main" }]).map((w) => (
            <option key={w.key || "all"} value={w.key}>{w.key === MAIN_WING ? "Main" : w.key === "" ? "All Wings" : wingShortLabel(w.label)}</option>
          ))}
        </select>
        {c && <Counts c={c} />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => data?.tree && setExpanded(defaultOpen(data.tree, data.levels || []))} data-testid="tree-reset"
            className="h-9 px-3 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50">State → District</button>
          <button type="button" onClick={() => data?.tree && setExpanded(allIds(data.tree))} data-testid="tree-expand-all"
            className="h-9 px-3 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50">Expand all</button>
          <button type="button" onClick={() => setExpanded(new Set())} data-testid="tree-collapse-all"
            className="h-9 px-3 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50">Collapse all</button>
          <button type="button" onClick={load} title="Refresh" className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        </div>
      </div>
      <div className="px-2 sm:px-3 py-2 flex flex-wrap items-center gap-3 text-[11px] text-gray-500 border-b border-gray-100">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded border border-green-300 bg-white inline-block" /> Filled post</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded border-2 border-red-400 bg-red-50 inline-block" /> Vacant post</span>
        <span className="inline-flex items-center gap-1"><MessageCircle size={12} className="text-[#128C4B]" /> Click a proposed person to WhatsApp them</span>
      </div>
      <div className="p-1 sm:p-2 overflow-x-hidden">
        {err ? <div className="p-6 text-sm text-red-600">{err}</div>
          : !data ? <div className="p-10 flex justify-center text-gray-400"><Loader2 className="animate-spin" /></div>
          : <TreeNode node={data.tree} expanded={expanded} toggle={toggle} depth={0} />}
        {data?.capped && <div className="px-3 py-2 text-xs text-amber-600">The organisation is very large: some posts are not shown. Choose a Wing to narrow it.</div>}
      </div>
    </div>
  );
}
