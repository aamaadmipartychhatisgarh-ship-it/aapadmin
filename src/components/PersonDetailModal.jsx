"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, Phone, MapPin, Activity, Award, Users as UsersIcon, Loader2, User, Shield, ExternalLink } from "lucide-react";
import Avatar from "@/components/Avatar";

// Popup shown when a user clicks a person's name or photo in a list/table —
// two modes:
//   type="worker" id={workerId}   fetches the full profile (/api/workers/:id):
//                                  photo, position, mobile, location, activity,
//                                  teams, badges — same data the full worker
//                                  page shows, just without navigating away.
//   type="user" data={rowObject}  renders the row data the list already has
//                                  loaded (username, role, district, status) —
//                                  no extra fetch, since there's no separate
//                                  user-detail endpoint today.
export default function PersonDetailModal({ type, id, data, onClose }) {
  const [worker, setWorker] = useState(null);
  const [loading, setLoading] = useState(type === "worker");

  useEffect(() => {
    if (type !== "worker" || !id) return;
    let alive = true;
    setLoading(true);
    fetch(`/api/workers/${id}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setWorker(d); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [type, id]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {type === "worker" ? (
          loading ? (
            <div className="p-10 flex items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>
          ) : worker ? (
            <WorkerBody w={worker.worker} teams={worker.teams} badges={worker.badges} onClose={onClose} />
          ) : (
            <div className="p-10 text-center text-gray-400 text-sm">Couldn't load this worker.</div>
          )
        ) : (
          <UserBody u={data} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function WorkerBody({ w, teams, badges, onClose }) {
  return (
    <div>
      <div className="p-5 border-b border-gray-100 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={w.name} src={w.photo_url} size={56} className="bg-[#164FA3] text-white ring-2 ring-[#164FA3]/20" textClassName="text-white" />
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 text-lg truncate">{w.name}</h2>
            <p className="text-sm text-gray-500 truncate">{w.position || "—"}</p>
          </div>
        </div>
        <button onClick={onClose} className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-50 hover:text-gray-600"><X size={18} /></button>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <MiniDetail icon={Phone} label="Mobile">{w.mobile || "—"}</MiniDetail>
          <MiniDetail icon={Activity} label="Status">
            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${w.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {w.status === "active" ? "Active" : "Pending"}
            </span>
          </MiniDetail>
        </div>
        <MiniDetail icon={MapPin} label="Location">
          {[w.zone_name, w.lok_sabha_name, w.district_name, w.assembly_name, w.ward_name].filter(Boolean).join(" / ") || "—"}
        </MiniDetail>
        <MiniDetail icon={Activity} label="Activity Score">
          <div className="flex items-center gap-2">
            <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#164FA3]" style={{ width: `${w.activity_score || 0}%` }} /></div>
            <span className="font-bold text-gray-700 text-sm">{w.activity_score || 0}</span>
          </div>
        </MiniDetail>

        {teams?.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5"><UsersIcon size={13} /> Teams</div>
            <div className="flex flex-wrap gap-1.5">
              {teams.map((t) => <span key={t.id} className="px-2.5 py-1 rounded-full bg-gray-100 text-xs font-medium text-gray-700">{t.name}</span>)}
            </div>
          </div>
        )}
        {badges?.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5"><Award size={13} className="text-[#FCB712]" /> Badges</div>
            <div className="flex flex-wrap gap-1.5">
              {badges.map((b, i) => <span key={i} className="px-2.5 py-1 rounded-full text-xs font-semibold text-white" style={{ background: b.color || "#164FA3" }}>{b.name}</span>)}
            </div>
          </div>
        )}
      </div>

      <div className="px-5 pb-5">
        <Link href={`/dashboard/admin/workers/${w.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#164FA3] hover:underline">
          Open full profile <ExternalLink size={13} />
        </Link>
      </div>
    </div>
  );
}

function UserBody({ u, onClose }) {
  return (
    <div>
      <div className="p-5 border-b border-gray-100 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={u?.username || u?.name} src={u?.photo_url} size={56} className="bg-[#164FA3] text-white" textClassName="text-white" />
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 text-lg truncate">{u?.username || u?.name}</h2>
            {u?.role && <p className="text-sm text-gray-500 truncate flex items-center gap-1"><Shield size={12} /> {String(u.role).replace(/_/g, " ")}</p>}
          </div>
        </div>
        <button onClick={onClose} className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-50 hover:text-gray-600"><X size={18} /></button>
      </div>
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

function MiniDetail({ icon: Icon, label, children }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 mb-0.5"><Icon size={12} /> {label}</div>
      <div className="text-sm text-gray-800 truncate">{children}</div>
    </div>
  );
}
