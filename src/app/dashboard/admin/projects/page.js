"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus, Download, X } from "lucide-react";

const TYPE_LABEL = { department: "Department Project", mla_fund: "MLA Fund Project" };
const newKey = () => (globalThis.crypto?.randomUUID?.() || `k${Date.now()}${Math.random().toString(36).slice(2)}`).slice(0, 64);
const Field = ({ label, children }) => <label className="block text-xs font-medium text-gray-500">{label}{children}</label>;
const inp = "mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white";

export default function ProjectsPage() {
  const [masters, setMasters] = useState(null);
  const [list, setList] = useState([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [selId, setSelId] = useState(null);
  const [state, setState] = useState("loading");
  const [create, setCreate] = useState({ project_type: "department", name: "" });
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  const qs = new URLSearchParams({ ...(typeFilter ? { type: typeFilter } : {}), ...(search.trim() ? { q: search.trim() } : {}) }).toString();
  const loadList = useCallback(async () => {
    const r = await fetch(`/api/projects?${qs}`, { cache: "no-store" });
    if (r.status === 401 || r.status === 403) { setState("denied"); return; }
    if (r.ok) { setList((await r.json()).projects); setState("ok"); }
  }, [qs]);
  useEffect(() => { fetch("/api/projects/masters", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setMasters); }, []);
  useEffect(() => { loadList(); }, [loadList]);

  async function createProject(e) {
    e.preventDefault(); setErr("");
    const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(create) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(d.message || "Could not create."); return; }
    setCreate({ ...create, name: "" }); await loadList(); setSelId(d.id);
  }

  if (state === "loading") return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  if (state === "denied") return <div className="p-8 text-center text-gray-500">This page is not available.</div>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-800">Projects</h1>
      <div className="grid lg:grid-cols-[22rem_1fr] gap-4">
        <div className="space-y-3">
          <form onSubmit={createProject} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm space-y-2">
            <select value={create.project_type} onChange={(e) => setCreate({ ...create, project_type: e.target.value })} className={inp} data-testid="new-type">
              <option value="department">Department Project</option><option value="mla_fund">MLA Fund Project</option>
            </select>
            <input value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} placeholder="Project name" className={inp} data-testid="new-name" />
            <button className="inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-[#164FA3] text-white text-sm font-semibold" data-testid="new-save"><Plus size={14} />Add project</button>
            {err && <div className="text-xs text-red-600">{err}</div>}
          </form>
          <div className="flex gap-1">
            {[["", "All"], ["department", "Department"], ["mla_fund", "MLA Fund"]].map(([k, l]) => (
              <button key={k} onClick={() => setTypeFilter(k)} className={`px-3 py-1 rounded-lg text-xs font-semibold border ${typeFilter === k ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-600 border-gray-200"}`}>{l}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects…" className={inp + " !mt-0"} data-testid="project-search" />
            <button onClick={() => setExporting(true)} className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm font-semibold whitespace-nowrap" data-testid="export-open"><Download size={14} />Excel</button>
          </div>
          {exporting && <ExportDialog qs={qs} onClose={() => setExporting(false)} />}
          <ul className="space-y-1.5" data-testid="project-list">
            {list.length === 0 && <li className="text-sm text-gray-400">No projects yet.</li>}
            {list.map((p) => (
              <li key={p.id}><button onClick={() => setSelId(p.id)} data-testid="project-item" className={`w-full text-left bg-white border rounded-lg p-2.5 text-sm ${selId === p.id ? "border-[#164FA3]" : "border-gray-100"}`}>
                <div className="font-semibold text-gray-800">{p.name}</div>
                <div className="text-xs text-gray-500">{TYPE_LABEL[p.project_type]} · {p.status_name || "No status"}{p.stage_name ? ` · ${p.stage_name}` : ""}</div>
              </button></li>
            ))}
          </ul>
        </div>
        {selId ? <ProjectDetail key={selId} id={selId} masters={masters} onChanged={loadList} /> : <div className="text-sm text-gray-400 p-6">Select a project to see its follow-up.</div>}
      </div>
    </div>
  );
}

function ProjectDetail({ id, masters, onChanged }) {
  const [data, setData] = useState(null);
  const [f, setF] = useState({ status_id: "", stage_id: "", remark: "", next_followup_date: "", next_followup_remark: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(newKey());

  const load = useCallback(async () => {
    const r = await fetch(`/api/projects/${id}`, { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json(); setData(d);
    // Reopening shows the SAVED status, stage and next follow-up.
    setF((x) => ({ ...x, status_id: d.project.status_id ? String(d.project.status_id) : "", stage_id: d.project.stage_id ? String(d.project.stage_id) : "", next_followup_date: d.project.next_followup_date || "", next_followup_remark: d.project.next_followup_remark || "" }));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  if (!data || !masters) return <div className="p-6"><Loader2 className="animate-spin text-[#164FA3]" /></div>;

  const p = data.project;
  const stages = masters.stages[p.project_type] || [];            // ONLY this project type's stages
  const status = masters.statuses.find((s) => String(s.id) === f.status_id);
  const noBudget = !!status?.skips_stage;

  async function submit(e) {
    e.preventDefault(); if (busy) return; setBusy(true); setMsg("");
    try {
      const body = { status_id: Number(f.status_id), remark: f.remark, next_followup_date: f.next_followup_date, next_followup_remark: f.next_followup_remark, submission_key: keyRef.current };
      if (!noBudget) body.stage_id = Number(f.stage_id);
      const r = await fetch(`/api/projects/${id}/followups`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.message || "Could not save."); return; }
      keyRef.current = newKey(); setF((x) => ({ ...x, remark: "" })); setMsg("Saved."); await load(); onChanged?.();
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3" data-testid="project-detail">
      <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
        <div className="font-bold text-gray-800">{p.name}</div>
        <div className="text-xs text-gray-500 mb-2" data-testid="detail-type">{TYPE_LABEL[p.project_type]}</div>
        <div className="grid sm:grid-cols-2 gap-2 text-sm">
          <div>Status: <b data-testid="cur-status">{p.status_name || "—"}</b></div>
          <div>Stage: <b data-testid="cur-stage">{p.stage_name || "—"}</b></div>
          <div className="sm:col-span-2">Latest Remark: <b data-testid="latest-remark">{p.latest_remark || "—"}</b> {p.latest_remark_at && <span className="text-xs text-gray-500" data-testid="latest-remark-at">({p.latest_remark_at})</span>}</div>
          <div>Next Follow-up Date: <b data-testid="cur-next-date">{p.next_followup_date || "—"}</b></div>
          <div>Next Follow-up Remark: <b data-testid="cur-next-remark">{p.next_followup_remark || "—"}</b></div>
        </div>
      </div>
      <form onSubmit={submit} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm grid sm:grid-cols-2 gap-2" data-testid="followup-form">
        <Field label="Status"><select value={f.status_id} onChange={(e) => setF({ ...f, status_id: e.target.value })} className={inp} data-testid="f-status"><option value="">Select…</option>{masters.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        {!noBudget && <Field label="Stage"><select value={f.stage_id} onChange={(e) => setF({ ...f, stage_id: e.target.value })} className={inp} data-testid="f-stage"><option value="">Select…</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
        <div className="sm:col-span-2"><Field label="Remark"><textarea value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} rows={2} className={inp} data-testid="f-remark" /></Field></div>
        {!noBudget && <>
          <Field label="Next Follow-up Date"><input type="date" value={f.next_followup_date} onChange={(e) => setF({ ...f, next_followup_date: e.target.value })} className={inp} data-testid="f-next-date" /></Field>
          <Field label="Next Follow-up Remark"><input value={f.next_followup_remark} onChange={(e) => setF({ ...f, next_followup_remark: e.target.value })} className={inp} data-testid="f-next-remark" /></Field>
        </>}
        <div className="sm:col-span-2 flex items-center gap-2">
          <button disabled={busy} className="h-9 px-3 rounded-lg bg-[#164FA3] text-white text-sm font-semibold disabled:opacity-60" data-testid="f-save">Save follow-up</button>
          {msg && <span className="text-xs text-gray-600" data-testid="f-msg">{msg}</span>}
        </div>
      </form>
      <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
        <div className="text-sm font-semibold mb-2">Follow-up History</div>
        <ul className="space-y-2" data-testid="history">
          {data.history.length === 0 && <li className="text-sm text-gray-400">No follow-ups yet.</li>}
          {data.history.map((h) => (
            <li key={h.id} className="text-sm border-b last:border-0 pb-2" data-testid="history-item">
              <div className="text-xs text-gray-500">{h.created_at} · {h.status_name || "—"}{h.stage_name ? ` · ${h.stage_name}` : ""} · {h.by_name || "—"}</div>
              <div>{h.remark}</div>
              {(h.next_followup_date || h.next_followup_remark) && <div className="text-xs text-gray-500">Next: {h.next_followup_date || "—"} {h.next_followup_remark || ""}</div>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Column selection before the Excel export: one checkbox per exportable column, Select All / Deselect All, and no
// empty export. The export uses the list's current type + search filters and returns every matching project.
function ExportDialog({ qs, onClose }) {
  const [cols, setCols] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/projects/export", { cache: "no-store" }).then((r) => r.json()).then((d) => { setCols(d.columns); setSel(new Set(d.columns.map((c) => c.key))); }); }, []);
  const toggle = (k) => { setMsg(""); setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; }); };
  async function go() {
    if (sel.size === 0) { setMsg("Select at least one column to export."); return; }
    setBusy(true); setMsg("");
    try {
      const keys = cols.filter((c) => sel.has(c.key)).map((c) => c.key).join(",");
      const r = await fetch(`/api/projects/export?${qs}${qs ? "&" : ""}columns=${encodeURIComponent(keys)}`);
      if (!r.ok) { setMsg((await r.json().catch(() => ({}))).message || "Export failed."); return; }
      const url = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = url; a.download = "projects.xlsx"; a.click(); URL.revokeObjectURL(url); onClose();
    } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" data-testid="export-dialog">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-4 space-y-3">
        <div className="flex items-center justify-between"><div className="font-bold">Export to Excel — choose columns</div><button onClick={onClose}><X size={16} /></button></div>
        {!cols ? <Loader2 className="animate-spin text-[#164FA3]" /> : <>
          <div className="flex gap-2 text-xs">
            <button type="button" onClick={() => { setMsg(""); setSel(new Set(cols.map((c) => c.key))); }} className="px-2 py-1 border rounded" data-testid="select-all">Select All</button>
            <button type="button" onClick={() => setSel(new Set())} className="px-2 py-1 border rounded" data-testid="deselect-all">Deselect All</button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-sm">
            {cols.map((c) => <label key={c.key} className="flex items-center gap-2"><input type="checkbox" checked={sel.has(c.key)} onChange={() => toggle(c.key)} data-testid={`col-${c.key}`} />{c.label}</label>)}
          </div>
          {msg && <div className="text-xs text-red-600" data-testid="export-msg">{msg}</div>}
          <button onClick={go} disabled={busy} className="h-9 px-3 rounded-lg bg-[#164FA3] text-white text-sm font-semibold disabled:opacity-60" data-testid="export-go">Export</button>
        </>}
      </div>
    </div>
  );
}
