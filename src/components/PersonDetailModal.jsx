"use client";

import { useEffect, useState } from "react";
import { X, Phone, MapPin, Activity, Users as UsersIcon, User } from "lucide-react";
import { initialsOf } from "@/components/Avatar";

// Popup shown when a user clicks a person's name or photo in a list/table —
// two modes, both rendering from data the list already has loaded (no extra
// fetch — there's no separate detail endpoint for either):
//   type="contact" data={rowObject}  a contacts-list row (name, phone, photo,
//                                     designation, district/ward, status).
//   type="user" data={rowObject}     a users-list row (username, role,
//                                     district, status).
//
// Layout: a full-width photo "hero" on top (name/subtitle overlaid at the
// bottom of the image, on a dark gradient scrim so text stays legible over
// any photo), details grid below — matches how a phone contact card reads.
export default function PersonDetailModal({ type, data, onClose }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {type === "contact" ? <ContactBody c={data} onClose={onClose} /> : <UserBody u={data} onClose={onClose} />}
      </div>
    </div>
  );
}

// Full-size photo hero: image (or a big initials/icon tile when there's no
// photo) filling the top of the card, name + subtitle overlaid at the bottom
// on a gradient scrim, close button floating top-right.
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
          {ini ? (
            <span className="text-white font-bold text-6xl leading-none">{ini}</span>
          ) : (
            <User size={72} className="text-white/80" />
          )}
        </div>
      )}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-white bg-black/30 hover:bg-black/50 backdrop-blur-sm"
      >
        <X size={18} />
      </button>
      <div className="absolute inset-x-0 bottom-0 px-5 py-3.5 bg-gradient-to-t from-black/70 via-black/30 to-transparent">
        <h2 className="font-bold text-white text-lg truncate drop-shadow-sm">{name}</h2>
        {subtitle && <p className="text-sm text-white/85 truncate">{subtitle}</p>}
      </div>
    </div>
  );
}

function ContactBody({ c, onClose }) {
  const subtitle = c?.designation_name || null;
  const location = [c?.district_name, c?.ward_name].filter(Boolean).join(" / ");
  return (
    <div>
      <Hero name={c?.person_name} photo={c?.photo_url} subtitle={subtitle} onClose={onClose} />

      <div className="p-5 space-y-3">
        {c?.phone_number && <MiniDetail icon={Phone} label="Phone">{c.phone_number}</MiniDetail>}
        {location && <MiniDetail icon={MapPin} label="Location">{location}</MiniDetail>}
        {c?.address && <MiniDetail icon={MapPin} label="Address">{c.address}</MiniDetail>}
        {c?.assigned_to_username && <MiniDetail icon={UsersIcon} label="Assigned to">{c.assigned_to_username}</MiniDetail>}
        {"is_completed" in (c || {}) && (
          <MiniDetail icon={Activity} label="Status">
            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${c.is_completed ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
              {c.is_completed ? "Done" : "Pending"}
            </span>
          </MiniDetail>
        )}
        {!c?.phone_number && !location && !c?.address && (
          <p className="text-sm text-gray-400">No further details available.</p>
        )}
      </div>
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

function MiniDetail({ icon: Icon, label, children }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 mb-0.5"><Icon size={12} /> {label}</div>
      <div className="text-sm text-gray-800 truncate">{children}</div>
    </div>
  );
}
