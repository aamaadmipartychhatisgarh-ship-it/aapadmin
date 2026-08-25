"use client";

import { useEffect, useState } from "react";
import { X, Phone, MapPin, Activity, Users as UsersIcon, User, Pencil, Loader2, Building2, Hash, Home, StickyNote, Calendar, Clock, Award } from "lucide-react";
import { initialsOf } from "@/components/Avatar";
import ProfilePhoto from "@/components/ProfilePhoto";

// Popup shown when a user clicks a person's name or photo in a list/table.
//   type="contact" data={rowObject}  — a Contacts row. This mode is a full
//     View + Edit profile card: rich details, an in-place edit form (name,
//     phone, designation, geography, address, pincode, village, remarks,
//     assigned caller, status), and profile-photo management (upload / replace
//     / remove) — all reusing the same scoped PUT + photo APIs the rest of the
//     module uses, so Super Admin edits anything and a Supervisor is limited to
//     their territory (server-enforced). Edits reflect immediately here and are
//     pushed back to the table via onSaved.
//   type="user" data={rowObject}     — a users-list row (read-only).
export default function PersonDetailModal({
  type, data, onClose,
  // contact-mode extras (all optional; absent => read-only view, as before)
  canEdit = false, canEditGeo = false, canEditStatus = false,
  contactUrl, photoUrl, users = [], designations = [], onSaved,
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {type === "contact"
          ? <ContactBody
              initial={data} onClose={onClose}
              canEdit={canEdit} canEditGeo={canEditGeo} canEditStatus={canEditStatus}
              contactUrl={contactUrl} photoUrl={photoUrl} users={users} designations={designations} onSaved={onSaved}
            />
          : <UserBody u={data} onClose={onClose} />}
      </div>
    </div>
  );
}

// "30 Jul 2026 • 10:45 AM" in the application timezone (Asia/Kolkata).
function fmtDateTime(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  return `${date} • ${time}`;
}

// Blue header with a large, editable profile photo centred on it.
function PhotoHeader({ contact, canEdit, persistPhoto, onPhoto, onClose, onEdit, editing }) {
  const subtitle = contact?.designation_name || null;
  return (
    <div className="relative bg-gradient-to-br from-[#164FA3] to-[#0B3A82] rounded-t-2xl px-5 pt-6 pb-5 text-center">
      <button
        onClick={onClose}
        className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-white bg-black/25 hover:bg-black/45 backdrop-blur-sm"
        aria-label="Close"
      >
        <X size={18} />
      </button>
      {canEdit && !editing && (
        <button
          onClick={onEdit}
          className="absolute top-3 left-3 inline-flex items-center gap-1.5 text-white bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-lg px-3 py-1.5 text-sm font-semibold"
        >
          <Pencil size={14} /> Edit
        </button>
      )}
      <div className="flex justify-center mb-3">
        <ProfilePhoto
          name={contact?.person_name}
          src={contact?.photo_url}
          size={112}
          square
          editable={canEdit}
          persist={persistPhoto}
          onChange={onPhoto}
          className="bg-white/15 border-2 border-white/30"
          textClassName="text-white"
        />
      </div>
      <h2 className="font-bold text-white text-xl truncate drop-shadow-sm">{contact?.person_name || "—"}</h2>
      {subtitle && <p className="text-sm text-white/85 truncate mt-0.5">{subtitle}</p>}
    </div>
  );
}

function ContactBody({ initial, onClose, canEdit, canEditGeo, canEditStatus, contactUrl, photoUrl, users, designations, onSaved }) {
  // Local copy so photo/field edits reflect instantly in this modal.
  const [contact, setContact] = useState(initial);
  const [editing, setEditing] = useState(false);
  useEffect(() => { setContact(initial); }, [initial]);

  // Upload the cropped blob, then persist its URL on the contact (scoped route).
  // blob === null removes the photo.
  async function persistPhoto(blob) {
    let url = null;
    if (blob) {
      const fd = new FormData();
      fd.append("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
      const up = await fetch("/api/uploads", { method: "POST", body: fd });
      const upData = await up.json();
      if (!up.ok) throw new Error(upData.message || "Upload failed");
      url = upData.url;
    }
    const r = await fetch(photoUrl(contact.id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photo_url: url }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || "Could not save the photo."); }
    return url;
  }
  function onPhoto(url) {
    const updated = { ...contact, photo_url: url };
    setContact(updated);
    onSaved?.(updated);
  }

  function handleSaved(updated) {
    setContact(updated);
    setEditing(false);
    onSaved?.(updated);
  }

  return (
    <div>
      <PhotoHeader
        contact={contact} canEdit={canEdit} persistPhoto={persistPhoto} onPhoto={onPhoto}
        onClose={onClose} onEdit={() => setEditing(true)} editing={editing}
      />
      {editing
        ? <ContactEditForm
            contact={contact} canEditGeo={canEditGeo} canEditStatus={canEditStatus}
            contactUrl={contactUrl} users={users} designations={designations}
            onCancel={() => setEditing(false)} onSaved={handleSaved}
          />
        : <ContactView contact={contact} />}
    </div>
  );
}

// --- read-only detail grid ---
function ContactView({ contact: c }) {
  const location = [c?.district_name, c?.ward_name].filter(Boolean).join(" / ");
  const created = fmtDateTime(c?.created_at);
  const updated = fmtDateTime(c?.updated_at);
  return (
    <div className="p-5 grid grid-cols-2 gap-x-4 gap-y-3.5">
      <MiniDetail icon={Phone} label="Phone">{c?.phone_number || "—"}</MiniDetail>
      <MiniDetail icon={Award} label="Designation">{c?.designation_name || "—"}</MiniDetail>
      <MiniDetail icon={MapPin} label="Zone">{c?.zone_name || "—"}</MiniDetail>
      <MiniDetail icon={MapPin} label="Lok Sabha">{c?.lok_sabha_name || "—"}</MiniDetail>
      <MiniDetail icon={MapPin} label="Assembly">{c?.assembly_name || "—"}</MiniDetail>
      <MiniDetail icon={MapPin} label="District">{c?.district_name || "—"}</MiniDetail>
      <MiniDetail icon={Home} label="Village / City">{c?.village || "—"}</MiniDetail>
      <MiniDetail icon={Hash} label="Pincode">{c?.pincode || "—"}</MiniDetail>
      <MiniDetail icon={Building2} label="Address" full>{c?.address || "—"}</MiniDetail>
      <MiniDetail icon={UsersIcon} label="Assigned to">{c?.assigned_to_username || "Pool"}</MiniDetail>
      <MiniDetail icon={Activity} label="Status">
        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${c?.is_completed ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
          {c?.is_completed ? "Done" : "Pending"}
        </span>
      </MiniDetail>
      <MiniDetail icon={StickyNote} label="Remarks" full>{c?.remarks || "—"}</MiniDetail>
      <MiniDetail icon={Calendar} label="Created">{created || "—"}</MiniDetail>
      <MiniDetail icon={Clock} label="Last Updated">{updated || "—"}</MiniDetail>
    </div>
  );
}

// --- edit form ---
const emptyForm = (c, canEditGeo) => ({
  person_name: c?.person_name || "",
  phone_number: c?.phone_number || "",
  designation_id: c?.designation_id || "",
  address: c?.address || "",
  remarks: c?.remarks || "",
  assigned_to_user_id: c?.assigned_to_user_id || "",
  is_completed: c?.is_completed ? 1 : 0,
  ...(canEditGeo ? {
    zone_id: c?.zone_id || "",
    lok_sabha_id: c?.lok_sabha_id || "",
    district_id: c?.district_id || "",
    assembly_id: c?.assembly_id || "",
    ward_id: c?.ward_id || "",
  } : {}),
});

function ContactEditForm({ contact, canEditGeo, canEditStatus, contactUrl, users, designations, onCancel, onSaved }) {
  const [form, setForm] = useState(() => emptyForm(contact, canEditGeo));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Highlights the mobile field when the server rejects a duplicate number.
  const [phoneDup, setPhoneDup] = useState(false);
  // Geo cascade option lists (admin only): Zone → Lok Sabha → District → Assembly.
  const [zones, setZones] = useState([]);
  const [lokSabhas, setLokSabhas] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [blocks, setBlocks] = useState([]);

  useEffect(() => {
    if (!canEditGeo) return;
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || []));
  }, [canEditGeo]);
  // Lok Sabha follows Zone (all when none picked).
  useEffect(() => {
    if (!canEditGeo) return;
    const url = form.zone_id ? `/api/locations?parent_id=${form.zone_id}` : "/api/locations?type=lok_sabha";
    fetch(url).then((r) => r.json()).then((d) => setLokSabhas((d.locations || []).filter((l) => l.type === "lok_sabha")));
  }, [canEditGeo, form.zone_id]);
  // District follows Lok Sabha (all when none picked).
  useEffect(() => {
    if (!canEditGeo) return;
    const url = form.lok_sabha_id ? `/api/locations?parent_id=${form.lok_sabha_id}` : "/api/locations?type=district";
    fetch(url).then((r) => r.json()).then((d) => setDistricts((d.locations || []).filter((l) => l.type === "district")));
  }, [canEditGeo, form.lok_sabha_id]);
  // Assembly follows District.
  useEffect(() => {
    if (!canEditGeo || !form.district_id) { setAssemblies([]); return; }
    fetch(`/api/locations?parent_id=${form.district_id}`).then((r) => r.json()).then((d) => setAssemblies((d.locations || []).filter((l) => l.type === "assembly")));
  }, [canEditGeo, form.district_id]);
  // Block (ward) follows Assembly.
  useEffect(() => {
    if (!canEditGeo || !form.assembly_id) { setBlocks([]); return; }
    fetch(`/api/locations?parent_id=${form.assembly_id}`).then((r) => r.json()).then((d) => setBlocks(d.locations || []));
  }, [canEditGeo, form.assembly_id]);

  async function save() {
    if (!form.person_name.trim() || !form.phone_number.trim()) {
      setError("Name and phone are required.");
      return;
    }
    setSaving(true); setError(""); setPhoneDup(false);
    const body = {
      person_name: form.person_name.trim(),
      phone_number: form.phone_number.trim(),
      designation_id: form.designation_id || null,
      address: form.address,
      remarks: form.remarks,
      assigned_to_user_id: form.assigned_to_user_id || null,
      ...(canEditStatus ? { is_completed: form.is_completed ? 1 : 0 } : {}),
      ...(canEditGeo ? {
        zone_id: form.zone_id || null,
        lok_sabha_id: form.lok_sabha_id || null,
        district_id: form.district_id || null,
        assembly_id: form.assembly_id || null,
        ward_id: form.ward_id || null,
      } : {}),
    };
    try {
      const r = await fetch(contactUrl(contact.id), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      // Keep the edit form open with all fields intact so only the mobile needs
      // fixing; a 409 flags the duplicate-number case for the field highlight.
      if (!r.ok) { setError(d.message || "Save failed"); if (r.status === 409) setPhoneDup(true); setSaving(false); return; }
      // Resolve display names client-side so the view + table update instantly.
      const desig = designations.find((x) => String(x.id) === String(form.designation_id));
      const caller = users.find((x) => String(x.id) === String(form.assigned_to_user_id));
      const zone = zones.find((x) => String(x.id) === String(form.zone_id));
      const ls = lokSabhas.find((x) => String(x.id) === String(form.lok_sabha_id));
      const dist = districts.find((x) => String(x.id) === String(form.district_id));
      const asm = assemblies.find((x) => String(x.id) === String(form.assembly_id));
      const merged = {
        ...contact, ...body,
        designation_name: desig?.name || (form.designation_id ? contact.designation_name : null),
        assigned_to_username: caller?.username || null,
        ...(canEditGeo ? {
          zone_name: zone?.name || (form.zone_id ? contact.zone_name : null),
          lok_sabha_name: ls?.name || (form.lok_sabha_id ? contact.lok_sabha_name : null),
          district_name: dist?.name || (form.district_id ? contact.district_name : null),
          assembly_name: asm?.name || (form.assembly_id ? contact.assembly_name : null),
        } : {}),
        updated_at: new Date().toISOString(),
      };
      // Prefer the server's fully-resolved record (correct for EVERY field,
      // including Block/ward_name and cases the client option lists don't cover)
      // so the list/search show the exact saved data with no stale labels.
      onSaved(d.contact || merged);
    } catch {
      setError("Save failed — network error.");
      setSaving(false);
    }
  }

  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-[#164FA3]/40 disabled:bg-gray-50 disabled:text-gray-400";
  const lbl = "block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1";
  return (
    <div className="p-5 space-y-3">
      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Full Name *" full><input className={inp} value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} /></Field>
        <Field label="Mobile Number *"><input className={phoneDup ? `${inp} border-red-400 ring-1 ring-red-300 bg-red-50` : inp} value={form.phone_number} onChange={(e) => { setForm({ ...form, phone_number: e.target.value }); if (phoneDup) { setPhoneDup(false); setError(""); } }} /></Field>
        {/* Address follows Phone, matching the Add Contact field order. */}
        <Field label="Address" full><input className={inp} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        <Field label="Designation">
          <select className={inp} value={form.designation_id} onChange={(e) => setForm({ ...form, designation_id: e.target.value })}>
            <option value="">No designation</option>
            {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        {canEditGeo && (
          <>
            <Field label="Zone">
              <select className={inp} value={form.zone_id} onChange={(e) => setForm({ ...form, zone_id: e.target.value, lok_sabha_id: "", district_id: "", assembly_id: "", ward_id: "" })}>
                <option value="">No zone</option>
                {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </Field>
            <Field label="Lok Sabha">
              <select className={inp} value={form.lok_sabha_id} onChange={(e) => setForm({ ...form, lok_sabha_id: e.target.value, district_id: "", assembly_id: "", ward_id: "" })}>
                <option value="">No Lok Sabha</option>
                {lokSabhas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <Field label="District">
              <select className={inp} value={form.district_id} onChange={(e) => setForm({ ...form, district_id: e.target.value, assembly_id: "", ward_id: "" })}>
                <option value="">No district</option>
                {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Assembly">
              <select className={inp} value={form.assembly_id} disabled={!form.district_id} onChange={(e) => setForm({ ...form, assembly_id: e.target.value, ward_id: "" })}>
                <option value="">{form.district_id ? "No assembly" : "Pick district"}</option>
                {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Block">
              <select className={inp} value={form.ward_id} disabled={!form.assembly_id} onChange={(e) => setForm({ ...form, ward_id: e.target.value })}>
                <option value="">{form.assembly_id ? "No block" : "Pick assembly"}</option>
                {blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          </>
        )}
        {/* Supervisor: geography is fixed to their territory (server-enforced —
            a supervisor cannot re-scope a contact), so the same Zone / Lok Sabha
            / District / Assembly / Block fields are shown here PRE-FILLED but
            read-only, matching the Add Contact field set without granting an
            out-of-territory move. Admin (canEditGeo) gets the editable cascade
            above. */}
        {!canEditGeo && (
          <>
            <Field label="Zone"><select className={inp} value="_" disabled><option value="_">{contact?.zone_name || "—"}</option></select></Field>
            <Field label="Lok Sabha"><select className={inp} value="_" disabled><option value="_">{contact?.lok_sabha_name || "—"}</option></select></Field>
            <Field label="District"><select className={inp} value="_" disabled><option value="_">{contact?.district_name || "—"}</option></select></Field>
            <Field label="Assembly"><select className={inp} value="_" disabled><option value="_">{contact?.assembly_name || "—"}</option></select></Field>
            <Field label="Block"><select className={inp} value="_" disabled><option value="_">{contact?.ward_name || "—"}</option></select></Field>
          </>
        )}
        <Field label="Assigned Caller">
          <select className={inp} value={form.assigned_to_user_id} onChange={(e) => setForm({ ...form, assigned_to_user_id: e.target.value })}>
            <option value="">— Pool (unassigned) —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
        </Field>
        {canEditStatus && (
          <Field label="Status">
            <select className={inp} value={form.is_completed} onChange={(e) => setForm({ ...form, is_completed: Number(e.target.value) })}>
              <option value={0}>Pending</option>
              <option value={1}>Done</option>
            </select>
          </Field>
        )}
        <Field label="Remarks / Notes" full>
          <textarea rows={2} className={inp} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} placeholder="Any notes about this contact" />
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} disabled={saving} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50">Cancel</button>
        <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold inline-flex items-center gap-2">
          {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : "Save"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{label}</div>
      {children}
    </div>
  );
}

function UserBody({ u, onClose }) {
  const subtitle = u?.role ? String(u.role).replace(/_/g, " ") : null;
  return (
    <div>
      <Hero name={u?.username || u?.name} photo={u?.photo_url} subtitle={subtitle} onClose={onClose} />
      <div className="p-5 space-y-3">
        {u?.home_district_name && <MiniDetail icon={MapPin} label="District">{u.home_district_name}</MiniDetail>}
        {"is_active" in (u || {}) && (
          <MiniDetail icon={Activity} label="Status">
            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${u.is_active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
              {u.is_active ? "Active" : "Inactive"}
            </span>
          </MiniDetail>
        )}
        {u?.calls != null && <MiniDetail icon={Phone} label="Calls">{u.calls}</MiniDetail>}
        {u?.connected != null && <MiniDetail icon={Activity} label="Connected">{u.connected}</MiniDetail>}
        {u?.follow_ups != null && <MiniDetail icon={User} label="Follow-ups">{u.follow_ups}</MiniDetail>}
        {!u?.home_district_name && !("is_active" in (u || {})) && u?.calls == null && (
          <p className="text-sm text-gray-400">No further details available.</p>
        )}
      </div>
    </div>
  );
}

// Full-size photo hero (used by the read-only user mode).
function Hero({ name, photo, subtitle, onClose }) {
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [photo]);
  const showImg = photo && !errored;
  const ini = initialsOf(name);
  return (
    <div className="relative w-full h-64 bg-gradient-to-br from-[#164FA3] to-[#0B3A82] rounded-t-2xl overflow-hidden">
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt={name || "photo"} onError={() => setErrored(true)} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          {ini ? <span className="text-white font-bold text-6xl leading-none">{ini}</span> : <User size={72} className="text-white/80" />}
        </div>
      )}
      <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-white bg-black/30 hover:bg-black/50 backdrop-blur-sm">
        <X size={18} />
      </button>
      <div className="absolute inset-x-0 bottom-0 px-5 py-3.5 bg-gradient-to-t from-black/70 via-black/30 to-transparent">
        <h2 className="font-bold text-white text-lg truncate drop-shadow-sm">{name}</h2>
        {subtitle && <p className="text-sm text-white/85 truncate">{subtitle}</p>}
      </div>
    </div>
  );
}

function MiniDetail({ icon: Icon, label, children, full }) {
  return (
    <div className={`min-w-0 ${full ? "col-span-2" : ""}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 mb-0.5"><Icon size={12} /> {label}</div>
      <div className="text-sm text-gray-800 break-words">{children}</div>
    </div>
  );
}
