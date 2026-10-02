"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { MessageSquare, Loader2, Plus, Check, X } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { isOversight } from "@/lib/permissions";
import { usePageGuard } from "@/components/usePageGuard";

// Announcements — every signed-in member can read; oversight can publish.
export default function AnnouncementsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { ready, allowed } = usePageGuard("portal_announcements", true);
  const canPost = isOversight(session);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/announcements", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setRows(d.announcements || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  async function publish() {
    if (!title.trim()) { setErr("Title is required."); return; }
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/announcements", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, body }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr([d.message, d.detail].filter(Boolean).join(" — ")); return; }
      setTitle(""); setBody(""); setComposing(false); load();
    } finally { setSaving(false); }
  }

  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={MessageSquare} title="Announcements" description="Updates and notices from the party." />

      {canPost && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          {!composing ? (
            <button onClick={() => setComposing(true)} className="inline-flex items-center gap-2 bg-[#164FA3] text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-800">
              <Plus size={16} /> New announcement
            </button>
          ) : (
            <div className="space-y-3">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Message (optional)" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
              {err && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-xs">{err}</div>}
              <div className="flex gap-2">
                <button onClick={publish} disabled={saving} className="inline-flex items-center gap-2 bg-[#164FA3] text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-800 disabled:opacity-50">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Publish
                </button>
                <button onClick={() => { setComposing(false); setErr(""); }} className="inline-flex items-center gap-2 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-semibold hover:bg-gray-50"><X size={16} /> Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {loading ? (
          <div className="py-16 text-center text-gray-400"><Loader2 className="inline animate-spin text-[#164FA3]" /></div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No announcements yet.</div>
        ) : rows.map((a) => (
          <div key={a.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-bold text-gray-900">{a.title}</h3>
              <span className="text-xs text-gray-400 shrink-0">{a.created_at ? new Date(a.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</span>
            </div>
            {a.body && <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{a.body}</p>}
            {a.created_by_name && <div className="text-[11px] text-gray-400 mt-2">Posted by {a.created_by_name}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
