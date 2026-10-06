"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PhoneCall, PhoneForwarded, TrendingUp, Trophy, Heart, ArrowRight, Loader2, Vote, UserCheck } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { isAdmin, isSupervisorRole, isPressMedia, isSocialMedia, isMediaUser, isCaller } from "@/lib/permissions";
import { useCallerPreview, isPreviewingCallerNow } from "@/lib/useCallerPreview";

export default function UserDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  // A Super Admin previewing a caller must see the caller's personal dashboard
  // here, not be bounced to /dashboard/admin.
  const { previewingCaller, viewAsCaller } = useCallerPreview(session);

  useEffect(() => {
    const previewing = isPreviewingCallerNow(session);
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated" && !previewing && isAdmin(session)) {
      router.push("/dashboard/admin");
    } else if (status === "authenticated" && !previewing && isSupervisorRole(session)) {
      router.push("/dashboard/supervisor");
    } else if (status === "authenticated" && !previewing && (isPressMedia(session) || isMediaUser(session))) {
      router.push("/dashboard/media");
    } else if (status === "authenticated" && !previewing && isSocialMedia(session)) {
      router.push("/dashboard/social-management");
    } else if (status === "authenticated") {
      // The caller's own stats — /api/me/stats resolves the impersonated caller
      // server-side (see actAs.js), so a previewing Super Admin sees the
      // selected caller's numbers, not their own.
      fetch("/api/me/stats").then((r) => r.json()).then((d) => setStats(d)).finally(() => setLoading(false));
    }
  }, [status, session, router]);

  if (status === "loading" || !session || (!previewingCaller && (isAdmin(session) || isSupervisorRole(session) || isPressMedia(session) || isSocialMedia(session) || isMediaUser(session)))) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  if (loading || !stats) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  const { today, week, sentiment, rank } = stats;
  const sentimentTotal = Object.values(sentiment).reduce((a, b) => a + b, 0);
  const supporterRate = sentimentTotal > 0 ? Math.round(((sentiment.positive + sentiment.supporter) / sentimentTotal) * 100) : 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {previewingCaller && viewAsCaller && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl p-3">
          Viewing <strong>{viewAsCaller.name}</strong>&apos;s Caller Dashboard as Super Admin — these are their numbers.
        </div>
      )}
      <div className="flex justify-between items-end flex-wrap gap-4">
        <div className="min-w-0">
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight truncate">Welcome, {previewingCaller && viewAsCaller ? viewAsCaller.name : session.user.name}</h1>
          <p className="text-gray-500 mt-2 font-medium">Your personal calling dashboard</p>
        </div>
        <Link href="/dashboard/workspace" className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 text-white px-5 py-2.5 rounded-xl font-semibold shadow-md shrink-0">
          Start Calling <ArrowRight size={16} />
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard label="Today's Calls" value={today.total} icon={PhoneCall} accent />
        <StatCard label="Connected" value={today.connected} icon={PhoneForwarded} />
        <StatCard label="Interested" value={today.interested} icon={Heart} />
        <StatCard label="Follow-ups" value={today.follow_ups} icon={TrendingUp} />
      </div>

      {/* Registration sections — callers run the drive on the ground. Visible ONLY
          to callers (or a Super Admin previewing the caller dashboard); every other
          role must be granted the page. Access is enforced again by the page guard
          and by every /api/registration route, never by this card alone. Counts are
          the live registration data (same API the module's own Dashboard uses). */}
      {(isCaller(session) || previewingCaller) && <RegistrationSections />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 lg:col-span-2">
          <h2 className="font-bold text-lg text-gray-900 mb-6">Last 7 Days</h2>
          <div className="h-[260px]">
            {week.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400">No calls yet this week</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={week.map(d => ({ day: new Date(d.day).toLocaleDateString("en-GB", { weekday: "short" }), calls: Number(d.calls) }))}>
                  <CartesianGrid stroke="#eee" strokeDasharray="5 5" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "#6B7280", fontSize: 12 }} />
                  <YAxis tick={{ fill: "#6B7280", fontSize: 12 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="calls" stroke="#164FA3" strokeWidth={3} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-[#FCB712]/10 text-[#FCB712] flex items-center justify-center">
                <Trophy size={20} />
              </div>
              <span className="font-bold text-gray-900">Today's Rank</span>
            </div>
            {rank.position ? (
              <>
                <h3 className="text-3xl font-bold text-gray-900">#{rank.position}<span className="text-gray-400 text-lg"> / {rank.team_size}</span></h3>
                <p className="text-sm text-gray-500 mt-1">Among standard callers</p>
              </>
            ) : (
              <p className="text-gray-400 text-sm">Not ranked yet</p>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Heart size={20} />
              </div>
              <span className="font-bold text-gray-900">Supporter Rate</span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900">{supporterRate}%</h3>
            <p className="text-sm text-gray-500 mt-1">All-time positive responses</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, accent }) {
  return (
    <div className={`${accent ? "bg-[#164FA3] text-white" : "bg-white"} rounded-2xl p-6 shadow-sm border border-gray-100 flex flex-col gap-4`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${accent ? "bg-white/20 text-white" : "bg-gray-100 text-[#164FA3]"}`}>
        <Icon size={20} />
      </div>
      <div>
        <h3 className={`text-3xl font-bold tracking-tighter ${accent ? "text-white" : "text-gray-900"}`}>{value}</h3>
        <p className={`text-sm font-medium mt-1 ${accent ? "text-blue-200" : "text-gray-500"}`}>{label}</p>
      </div>
    </div>
  );
}

// The two Caller-dashboard registration sections with live counts from the drive.
function RegistrationSections() {
  const [sum, setSum] = useState(null); // { voters, new_workers, total_workers, active_workers } | null
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/registration/dashboard", { cache: "no-store" })
      .then(async (r) => { if (!r.ok) { if (alive) setDenied(true); return null; } return r.json(); })
      .then((d) => {
        if (!alive || !d) return;
        // Lifetime registrations (voters / new workers) + karyakarta link counts.
        const sm = d.summary || {};
        setSum({ voters: sm.lifetime?.voters, new_workers: sm.lifetime?.new_workers, total_workers: sm.total_workers, active_workers: sm.active_workers });
      })
      .catch(() => { if (alive) setDenied(true); });
    return () => { alive = false; };
  }, []);
  if (denied) return null; // not permitted server-side → show nothing
  const n = (v) => (sum ? Number(v || 0).toLocaleString("en-IN") : "…");
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
      <Link href="/dashboard/admin/voter-registration?tab=people" className="group bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center gap-4 hover:border-[#164FA3]/40 hover:shadow-md transition">
        <div className="w-12 h-12 rounded-xl bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center shrink-0"><Vote size={22} /></div>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-gray-900">Voter Registration</div>
          <div className="text-sm text-gray-500">Register voters and review submissions</div>
          <div className="text-xs text-gray-500 mt-1"><span className="font-semibold text-gray-900">{n(sum?.voters)}</span> voters registered · <span className="font-semibold text-gray-900">{n(sum?.new_workers)}</span> new workers</div>
        </div>
        <ArrowRight size={18} className="text-gray-300 group-hover:text-[#164FA3]" />
      </Link>
      <Link href="/dashboard/admin/voter-registration?tab=workers" className="group bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center gap-4 hover:border-[#164FA3]/40 hover:shadow-md transition">
        <div className="w-12 h-12 rounded-xl bg-[#FCB712]/10 text-[#FCB712] flex items-center justify-center shrink-0"><UserCheck size={22} /></div>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-gray-900">Worker Registration</div>
          <div className="text-sm text-gray-500">Register karyakartas and their login links</div>
          <div className="text-xs text-gray-500 mt-1"><span className="font-semibold text-gray-900">{n(sum?.active_workers)}</span> active of <span className="font-semibold text-gray-900">{n(sum?.total_workers)}</span> karyakartas</div>
        </div>
        <ArrowRight size={18} className="text-gray-300 group-hover:text-[#164FA3]" />
      </Link>
    </div>
  );
}
