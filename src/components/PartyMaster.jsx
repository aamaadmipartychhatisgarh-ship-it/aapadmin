"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Pencil, Trash2, Search, Flag, X } from "lucide-react";
import Avatar from "@/components/Avatar";
import ProfilePhoto from "@/components/ProfilePhoto";

const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-[#164FA3]/30";
const lbl = "block text-xs font-semibold text-gray-500 mb-1";

async function api(url, opts) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || "Request failed");
  return d;
}

// Party Master — Administration master for political party Name + Logo. Mirrors
// the Caste master (same look, same flash/fail toasts) and stores to /api/parties.
// The logo uploads through the shared durable image uploader (/api/uploads), so
// it persists across refreshes/redeploys just like every other profile photo.
export default function PartyMaster({ flash, fail }) {
  const [parties, setParties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // null | {} (new) | party (edit)
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api("/api/parties"); setParties(d.parties || []); }
    catch (e) { fail(e.message); } finally { setLoading(false); }
  }, [fail]);
  useEffect(() => { load(); }, [load]);

  const q = search.trim().toLowerCase();
  const visible = parties.filter((p) => !q || p.name.toLowerCase().includes(q));

  async function removeParty(p) {
    if (!confirm(`Delete "${p.name}" from the Party Master? This cannot be undone.\n\nExisting MLA/competitor records that used this party keep their party name — they just stop showing its logo.`)) return;
    setBusyId(p.id);
    try {
      await api(`/api/parties/${p.id}`, { method: "DELETE" });
      flash(`"${p.name}" deleted.`);
      await load();
    } catch (e) { fail(e.message); } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-[#164FA3]/10 text-[#164FA3]"><Flag size={18} /></span>
            <div>
              <h3 className="font-bold text-gray-900">Party Master</h3>
              <p className="text-sm text-gray-500">The single source of truth for party names + logos. Used by the party dropdowns across the app.</p>
            </div>
          </div>
          <button onClick={() => setEditing({})} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3.5 py-2 rounded-lg text-sm font-semibold"><Plus size={15} /> Add Party</button>
        </div>

        <div className="relative max-w-xs mb-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search parties…" className={`${inp} pl-9`} />
        </div>

        {loading ? (
          <div className="py-10 flex items-center justify-center text-gray-400"><Loader2 className="animate-spin mr-2" size={18} /> Loading…</div>
        ) : visible.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">{parties.length === 0 ? "No parties yet. Click “Add Party” to create the first one." : "No parties match your search."}</div>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-3 w-16">Logo</th>
                  <th className="py-2 pr-3">Party Name</th>
                  <th className="py-2 pr-3 w-32 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="py-2.5 pr-3"><Avatar name={p.name} src={p.logo_url} size={34} square className="bg-gray-100 border border-gray-200" textClassName="text-gray-500 text-[11px]" /></td>
                    <td className="py-2.5 pr-3 font-semibold text-gray-800">{p.name}</td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditing(p)} className="text-gray-500 hover:text-[#164FA3] p-1.5 rounded-md hover:bg-blue-50" title="Edit"><Pencil size={15} /></button>
                        <button onClick={() => removeParty(p)} disabled={busyId === p.id} className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete">{busyId === p.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && <PartyEditor party={editing} existing={parties} onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); flash(msg); load(); }} />}
    </div>
  );
}

function PartyEditor({ party, existing, onClose, onSaved }) {
  const isNew = !party?.id;
  const [name, setName] = useState(party?.name || "");
  const [logoUrl, setLogoUrl] = useState(party?.logo_url || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const norm = name.replace(/\s+/g, " ").trim().toLowerCase();
  const dup = norm && (existing || []).some((p) => p.id !== party?.id && p.name.trim().toLowerCase() === norm);

  async function save() {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean) { setErr("Party name is required."); return; }
    if (dup) { setErr(`"${clean}" already exists in the party master.`); return; }
    setSaving(true); setErr("");
    const body = { name: clean, logo_url: logoUrl || null };
    try {
      if (isNew) await api("/api/parties", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      else await api(`/api/parties/${party.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      onSaved(isNew ? `"${clean}" added to the party master.` : `"${clean}" updated.`);
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900">{isNew ? "Add Party" : "Edit Party"}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <ProfilePhoto name={name || "Party"} src={logoUrl} size={84} square editable onChange={(url) => setLogoUrl(url || "")} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3]" />
          <span className="text-[11px] text-gray-400">Party Logo — JPG, PNG, WEBP</span>
        </div>
        <div>
          <label className={lbl}>Party Name <span className="text-red-500">*</span></label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aam Aadmi Party" className={inp} />
          {dup && <div className="text-[11px] text-amber-600 mt-1">This name already exists in the party master.</div>}
        </div>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-100">Cancel</button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60">
            {saving && <Loader2 size={15} className="animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
