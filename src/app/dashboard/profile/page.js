"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, UserRound, Check } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import ProfilePhoto from "@/components/ProfilePhoto";
import { roleLabel } from "@/lib/permissions";

export default function Page() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  if (status === "loading") {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  if (status === "unauthenticated" || !session) {
    router.push("/login");
    return null;
  }
  return <Body session={session} update={update} />;
}

function Body({ session, update }) {
  const [photoUrl, setPhotoUrl] = useState(session.user.photo_url || null);
  const [err, setErr] = useState("");

  // Upload the cropped photo (DB-stored, /api/users/photo), then attach it to
  // this account (/api/users/me/photo — self-service, never touches role or
  // other admin-only fields). Mirrors saveActivePhoto in dashboard/workspace.
  async function persist(blob) {
    setErr("");
    let url = null;
    try {
      if (blob) {
        const fd = new FormData();
        fd.append("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
        const up = await fetch("/api/users/photo", { method: "POST", body: fd });
        const upData = await up.json();
        if (!up.ok) throw new Error(upData.message || "Upload failed");
        url = upData.url;
      }
      const r = await fetch("/api/users/me/photo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!r.ok) throw new Error("Could not save the photo.");
      return url;
    } catch (e) {
      setErr(e.message);
      throw e;
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-2xl">
      <PageHeader
        icon={UserRound}
        title="My Profile"
        description="Your account photo and details."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "My Profile" }]}
      />

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-5">
          <ProfilePhoto
            name={session.user.name}
            src={photoUrl}
            size={96}
            persist={persist}
            onChange={(url) => {
              setPhotoUrl(url);
              // Refresh the JWT's photo_url so the header avatar updates
              // everywhere without needing to sign out and back in.
              update({ photo_url: url });
            }}
          />
          <div className="min-w-0">
            <div className="text-xl font-bold text-gray-900 truncate">{session.user.name}</div>
            <div className="text-sm text-gray-500 mt-0.5">{roleLabel(session.user.role)}</div>
          </div>
        </div>
        {err && <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{err}</div>}
        <p className="mt-5 text-xs text-gray-400">
          Tap your photo to upload, crop, replace or remove it. Images are compressed and stored securely — visible only to signed-in users.
        </p>
      </div>

      <MemberDetails />
    </div>
  );
}

// Self-service name + phone, shown ONLY for member accounts that are linked to a
// contact record (auto-provisioned portal members). Admins/callers whose account
// has no linked contact never see this card. Writes go to the narrow
// /api/users/me/profile endpoint, which only ever touches the caller's own contact.
function MemberDetails() {
  const [state, setState] = useState({ loading: true, hasContact: false, name: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/users/me/profile", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (active) setState({ loading: false, hasContact: !!d.hasContact, name: d.name || "", phone: d.phone || "" }); })
      .catch(() => { if (active) setState((s) => ({ ...s, loading: false })); });
    return () => { active = false; };
  }, []);

  async function save() {
    setSaving(true); setErr(""); setMsg("");
    try {
      const r = await fetch("/api/users/me/profile", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: state.name, phone: state.phone }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || "Could not save."); return; }
      setMsg("Saved.");
      setTimeout(() => setMsg(""), 2500);
    } finally { setSaving(false); }
  }

  if (state.loading || !state.hasContact) return null;
  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
      <div>
        <h2 className="font-bold text-gray-900">My Details</h2>
        <p className="text-xs text-gray-400 mt-0.5">Update your own name and contact number.</p>
      </div>
      <label className="block">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</span>
        <input className={`${inp} mt-1`} value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} placeholder="Your full name" />
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Phone</span>
        <input className={`${inp} mt-1`} value={state.phone} onChange={(e) => setState({ ...state, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="10-digit number" inputMode="numeric" />
      </label>
      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{err}</div>}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Save
        </button>
        {msg && <span className="text-sm text-emerald-600 font-medium">{msg}</span>}
      </div>
    </div>
  );
}
