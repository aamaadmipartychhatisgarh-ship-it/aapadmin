"use client";

import { useEffect, useState, useRef } from "react";
import { Users } from "lucide-react";

// Shared Add/Edit worker form. Field labels: Sambhag (Zone), Block (ward),
// Polling Station (booth) — DB column names unchanged.
export function WorkerModal({ title, initial, districts, designations, onClose, onSave, saving, error }) {
  const [form, setForm] = useState(initial);
  const [zones, setZones] = useState([]);
  const [lokSabhas, setLokSabhas] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [wards, setWards] = useState([]);
  const [booths, setBooths] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const photoRef = useRef(null);

  useEffect(() => {
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || []));
  }, []);
  useEffect(() => {
    if (form.zone_id) fetch(`/api/locations?parent_id=${form.zone_id}`).then((r) => r.json()).then((d) => setLokSabhas(d.locations || []));
    else fetch("/api/locations?type=lok_sabha").then((r) => r.json()).then((d) => setLokSabhas(d.locations || []));
  }, [form.zone_id]);
  useEffect(() => {
    if (form.district_id) fetch(`/api/locations?parent_id=${form.district_id}`).then((r) => r.json()).then((d) => setAssemblies(d.locations || []));
    else setAssemblies([]);
  }, [form.district_id]);
  useEffect(() => {
    if (form.assembly_id) fetch(`/api/locations?parent_id=${form.assembly_id}`).then((r) => r.json()).then((d) => setWards(d.locations || []));
    else setWards([]);
  }, [form.assembly_id]);
  useEffect(() => {
    if (form.ward_id) fetch(`/api/locations?parent_id=${form.ward_id}`).then((r) => r.json()).then((d) => setBooths(d.locations || []));
    else setBooths([]);
  }, [form.ward_id]);

  async function uploadPhoto(file) {
    setUploadError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/uploads", { method: "POST", body: fd });
      const d = await r.json();
      if (r.ok) setForm((f) => ({ ...f, photo_url: d.url }));
      else setUploadError(d.message || "Upload failed");
    } catch {
      setUploadError("Upload failed — network error.");
    } finally {
      setUploading(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  }

  // A worker can hold multiple designations — stored comma-separated in `position`.
  const selectedDesignations = (form.position || "").split(",").map((s) => s.trim()).filter(Boolean);
  const customDesignations = selectedDesignations.filter((n) => !designations.some((d) => d.name === n));
  function toggleDesignation(name) {
    const next = selectedDesignations.includes(name)
      ? selectedDesignations.filter((n) => n !== name)
      : [...selectedDesignations, name];
    setForm({ ...form, position: next.join(", ") });
  }

  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-3 max-h-[90vh] overflow-auto">
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}
        {uploadError && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{uploadError}</div>}

        {/* Photo */}
        <div className="flex items-center gap-3">
          {form.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.photo_url} alt="Worker photo" className="w-14 h-14 rounded-full object-cover border border-gray-200" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400"><Users size={20} /></div>
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => photoRef.current?.click()} disabled={uploading} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {uploading ? "Uploading…" : form.photo_url ? "Change photo" : "Upload photo"}
            </button>
            {form.photo_url && (
              <button type="button" onClick={() => setForm({ ...form, photo_url: "" })} className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">Remove</button>
            )}
            <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Fld label="Name *"><input className={inp} placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Fld>
          <Fld label="Mobile"><input className={inp} placeholder="Mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></Fld>
          <div className="col-span-2">
            <Fld label="Designations (select one or more)">
              <div className="flex flex-wrap gap-2">
                {/* Imported workers can carry designations that aren't in the master list — keep them removable. */}
                {customDesignations.map((n) => (
                  <button key={n} type="button" onClick={() => toggleDesignation(n)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold border bg-[#164FA3] text-white border-[#164FA3]">
                    ✓ {n}
                  </button>
                ))}
                {designations.map((d) => {
                  const on = selectedDesignations.includes(d.name);
                  return (
                    <button key={d.id} type="button" onClick={() => toggleDesignation(d.name)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${on ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-600 border-gray-200 hover:border-[#164FA3]"}`}>
                      {on ? "✓ " : ""}{d.name}
                    </button>
                  );
                })}
                {designations.length === 0 && customDesignations.length === 0 && (
                  <span className="text-xs text-gray-400">No designations yet — add them in Master Data.</span>
                )}
              </div>
            </Fld>
          </div>
          <Fld label="Skills"><input className={inp} placeholder="Skills (comma-sep)" value={form.skills || ""} onChange={(e) => setForm({ ...form, skills: e.target.value })} /></Fld>
          <div className="col-span-2">
            <Fld label="Address"><input className={inp} placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Fld>
          </div>
          <Fld label="Sambhag (Zone)">
            <select className={inp} value={form.zone_id} onChange={(e) => setForm({ ...form, zone_id: e.target.value, lok_sabha_id: "" })}>
              <option value="">Select Sambhag</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </Fld>
          <Fld label="Lok Sabha">
            <select className={inp} value={form.lok_sabha_id} onChange={(e) => setForm({ ...form, lok_sabha_id: e.target.value })}>
              <option value="">Select Lok Sabha</option>
              {lokSabhas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Fld>
          <Fld label="District">
            <select className={inp} value={form.district_id} onChange={(e) => setForm({ ...form, district_id: e.target.value, assembly_id: "", ward_id: "", booth_id: "" })}>
              <option value="">Select district</option>
              {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Fld>
          <Fld label="Assembly">
            <select className={inp} value={form.assembly_id} onChange={(e) => setForm({ ...form, assembly_id: e.target.value, ward_id: "", booth_id: "" })} disabled={!form.district_id}>
              <option value="">Select assembly</option>
              {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Fld>
          <Fld label="Block">
            <select className={inp} value={form.ward_id} onChange={(e) => setForm({ ...form, ward_id: e.target.value, booth_id: "" })} disabled={!form.assembly_id}>
              <option value="">Select block</option>
              {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Fld>
          <Fld label="Polling Station">
            <select className={inp} value={form.booth_id} onChange={(e) => setForm({ ...form, booth_id: e.target.value })} disabled={!form.ward_id}>
              <option value="">Select polling station</option>
              {booths.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Fld>
          <Fld label="Status">
            <select className={inp} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Fld>
          <div>
            <label className="text-xs text-gray-500">Activity score: {form.activity_score}</label>
            <input type="range" min="0" max="100" value={form.activity_score} onChange={(e) => setForm({ ...form, activity_score: Number(e.target.value) })} className="w-full" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={() => onSave(form)} disabled={saving || !form.name || uploading} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function Fld({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

export function EditWorkerModal({ worker, districts, designations, onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(form) {
    setSaving(true); setError("");
    const r = await fetch(`/api/workers/${worker.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const d = await r.json();
    if (r.ok) onSaved(); else { setError(d.message || "Failed"); setSaving(false); }
  }

  return (
    <WorkerModal
      title="Edit Member"
      initial={{
        name: worker.name || "",
        mobile: worker.mobile || "",
        photo_url: worker.photo_url || "",
        position: worker.position || "",
        skills: worker.skills || "",
        activity_score: worker.activity_score ?? 50,
        address: worker.address || "",
        zone_id: worker.zone_id || "",
        lok_sabha_id: worker.lok_sabha_id || "",
        district_id: worker.district_id || "",
        assembly_id: worker.assembly_id || "",
        ward_id: worker.ward_id || "",
        booth_id: worker.booth_id || "",
        status: worker.status || "active",
      }}
      districts={districts}
      designations={designations}
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={error}
    />
  );
}

export function AddWorkerModal({ districts, designations, onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(form) {
    setSaving(true); setError("");
    const r = await fetch("/api/workers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await r.json();
    if (r.ok) onSaved(); else { setError(d.message || "Failed"); setSaving(false); }
  }

  return (
    <WorkerModal
      title="Add Worker"
      initial={{
        name: "", mobile: "", photo_url: "", position: "", skills: "", address: "",
        zone_id: "", lok_sabha_id: "", district_id: "", assembly_id: "", ward_id: "", booth_id: "",
        status: "active", activity_score: 50,
      }}
      districts={districts}
      designations={designations}
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={error}
    />
  );
}
