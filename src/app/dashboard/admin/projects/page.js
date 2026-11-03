"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";

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

  const loadList = useCallback(async () => {
    const r = await fetch(`/api/projects${typeFilter ? `?type=${typeFilter}` : ""}`, { cache: "no-store" });
    if (r.status === 401 || r.status === 403) { setState("denied"); return; }
    if (r.ok) { setList((await r.json()).projects); setState("ok"); }
  }, [typeFilter]);
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
