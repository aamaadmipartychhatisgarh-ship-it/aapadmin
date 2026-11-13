"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, ChevronDown, Loader2, RefreshCw, MessageCircle, UserX, AlertTriangle, ArrowRight, Users } from "lucide-react";
import Avatar from "@/components/Avatar";
import ReminderName from "@/components/vacancies/ReminderName";
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

// Post number (Designation order within its unit): green for a filled post, red for a vacant one.
function Num({ n, filled }) {
  return (
    <span data-testid="post-number"
      className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-bold text-white ${filled ? "bg-green-600" : "bg-red-600"}`}>{n}</span>
  );
}
const whereOf = (p) => `${p.level === "state" ? p.level_label : `${p.level_label} · ${p.location_name}`}${p.wing ? ` · ${wingShortLabel(p.wing)}` : ""}`;

function FilledCard({ p, n }) {
  return (
    <div className="h-full rounded-xl border-2 border-green-300 bg-green-50/40 p-3 flex flex-col gap-2 min-w-0 shadow-sm" data-testid="post-filled" data-designation={p.designation_name}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 text-[10px] font-bold text-white bg-green-600 rounded px-1.5 py-0.5 tracking-wide">FILLED</span>
        <span className="text-[11px] text-green-800 truncate" title={whereOf(p)}>{whereOf(p)}</span>
      </div>
      <div className="flex items-start gap-2 min-w-0">
        <Num n={n} filled />
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          {p.holders.map((h) => (
            <div key={h.contact_id} className="flex items-center gap-2.5 min-w-0" data-testid="post-holder">
              <Avatar name={h.name} src={h.photo_url} size={40} className="shrink-0 bg-white border border-gray-200" textClassName="text-[#164FA3] text-xs" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate" title={h.name} data-testid="holder-name">{h.name}</div>
                <div className="text-xs text-gray-600 truncate" title={p.designation_name}>{p.designation_name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function VacantCard({ p, n }) {
  const ab = p.assigned_by;
  return (
    <div className="h-full rounded-xl border-2 border-red-400 bg-red-50 p-3 flex flex-col gap-2 min-w-0 shadow-sm" data-testid="post-vacant" data-designation={p.designation_name}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 text-[10px] font-bold text-white bg-red-600 rounded px-1.5 py-0.5 tracking-wide">VACANT</span>
        <span className="text-[11px] text-red-700 truncate" title={whereOf(p)}>{whereOf(p)}</span>
      </div>
      {/* The vacant POST (designation) — prominent, never mixed up with the proposed person below. */}
      <div className="flex items-start gap-2 min-w-0">
        <Num n={n} />
        <div className="text-[15px] leading-snug font-bold text-red-700 break-words" data-testid="vacant-designation">{p.designation_name}</div>
      </div>
      {p.needs_review && (
        <div className="flex items-start gap-1 text-[11px] text-amber-700" data-testid="vacant-review">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>Needs data check{p.review_people.length ? `: ${p.review_people.join(", ")} may hold it (location not set)` : ""}</span>
        </div>
      )}
      <div className="mt-auto border-t border-red-200 pt-2 flex flex-col gap-1.5">
        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Proposed person</div>
        {p.proposed.map((x) => (
          <div key={x.assignment_id} className="flex items-center gap-2 min-w-0" data-testid="proposed-person">
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
        {/* Who is responsible for filling the post (the vacancy-responsibility rule) — not a proposed person. */}
        {ab ? (
          <div data-testid="assigned-by" className="self-stretch max-w-full rounded-md bg-amber-50 border border-amber-300 px-2 py-1.5">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 mb-1"><Users size={11} /> Assigned By</div>
            {/* One line per responsible role: [photo] Role · the person who holds it in this post's area. */}
            {(ab.slots || []).flatMap((sl, si) => (sl.people.length ? sl.people.map((h) => ({ key: `${si}:${h.contact_id || h.name}`, sl, h })) : [{ key: `${si}:none`, sl, h: null }])).map(({ key, sl, h }) => (
              <div key={key} className="flex items-center gap-1.5 min-w-0 py-0.5" data-testid="assigned-by-line" data-role={sl.label} data-contact={h?.contact_id || ""}>
                {h ? (
                  <Avatar name={h.name} src={h.photo_url} size={22} className="shrink-0 bg-white border border-amber-300" textClassName="text-amber-800 text-[9px]" />
                ) : (
                  <span className="shrink-0 w-[22px] h-[22px] rounded-full border border-dashed border-amber-400 bg-white inline-flex items-center justify-center text-amber-400" data-testid="assigned-by-empty"><UserX size={11} /></span>
                )}
                <span className="text-[11px] font-semibold text-amber-900 whitespace-nowrap" data-testid="assigned-by-role">{sl.label}</span>
                {h ? (
                  <span className="text-[11px] min-w-0 inline-flex items-center gap-0.5"><span className="text-gray-400">·</span>
                    <ReminderName contactId={h.contact_id} name={h.name} lokSabhaId={p.lok_sabha_id} className="text-[11px]" />
                  </span>
                ) : (
                  <span className="text-[11px] truncate text-gray-400 italic" title={`Not assigned${sl.area ? ` in ${sl.area}` : ""}`}>· Not assigned</span>
                )}
              </div>
            ))}
          </div>
        ) : p.proposed.length === 0 ? (
          <div className="inline-flex items-center gap-1 text-xs text-gray-500 italic" data-testid="proposed-none"><UserX size={13} /> Person Not Assigned</div>
        ) : null}
      </div>
    </div>
  );
}

// The posts of one unit as a numbered flow (1 -> 2 -> 3 ...) in Designation order. Rows are measured from the
// container width so each row reads left to right with arrows between its cards, and every row starts aligned.
const CARD_MIN = 230;
const ARROW_W = 22;
function PostFlow({ posts }) {
  const ref = useRef(null);
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setCols(Math.max(1, Math.min(4, Math.floor((el.clientWidth + ARROW_W) / (CARD_MIN + ARROW_W)))));
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rows = [];
  for (let i = 0; i < posts.length; i += cols) rows.push(posts.slice(i, i + cols));
  return (
    <div ref={ref} className="flex flex-col gap-3 px-2 sm:px-3 py-2" data-testid="node-posts">
      {rows.map((row, ri) => (
        <div key={ri} className="flex items-stretch">
          {Array.from({ length: cols }).map((_, ci) => {
            const p = row[ci];
            const n = ri * cols + ci + 1;
            return (
              <div key={p ? p.key : `pad${ci}`} className="flex items-stretch flex-1 min-w-0" style={{ flexBasis: 0 }}>
                {ci > 0 && (
                  <div className="shrink-0 flex items-center justify-center text-gray-400" style={{ width: ARROW_W }} aria-hidden="true">
                    {p ? <ArrowRight size={16} strokeWidth={2.5} data-testid="flow-arrow" /> : null}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {p ? (p.status === "filled" ? <FilledCard p={p} n={n} /> : <VacantCard p={p} n={n} />) : null}
                </div>
              </div>
            );
          })}
        </div>
      ))}
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
            <PostFlow posts={node.posts} />
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
        <span className="inline-flex items-center gap-1"><span className="inline-flex items-center gap-1 px-1.5 rounded bg-amber-100 border border-amber-300 text-amber-900"><Users size={11} /> Assigned By</span> role responsible for filling the post</span>
        <span className="inline-flex items-center gap-1"><span className="inline-flex w-4 h-4 rounded-full bg-red-600 text-white text-[9px] font-bold items-center justify-center">1</span> Designation order</span>
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
