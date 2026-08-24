"use client";

import { useEffect, useState } from "react";
import { X, Users, CalendarClock } from "lucide-react";

// PROMPT 4 — "Every Monday – Please update Followers." popup.
//
// Shown to whoever opens the Social Media Command Center (the page is already
// gated to social-media/oversight users), and ONLY on Mondays. Dismissal is
// remembered per-week in localStorage keyed by that week's Monday date, so:
//   • it appears automatically on Monday,
//   • it does not pop again on every render / navigation once dismissed,
//   • it survives refresh and login/logout (localStorage) until the next Monday.
// It is purely a reminder — it never reads, writes or resets follower data.

const KEY = "followers_monday_reminder_dismissed";

// The date (YYYY-MM-DD) of the Monday of the current week. Two visits in the
// same week map to the same key; next week's Monday is a new key.
function mondayOfThisWeek() {
  const d = new Date();
  const day = d.getDay(); // 0 Sun … 1 Mon … 6 Sat
  const diff = (day + 6) % 7; // days since Monday
  d.setDate(d.getDate() - diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function FollowersMondayReminder() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Only on Mondays.
    if (new Date().getDay() !== 1) return;
    let dismissed = null;
    try { dismissed = localStorage.getItem(KEY); } catch { /* ignore */ }
    if (dismissed !== mondayOfThisWeek()) setShow(true);
  }, []);

  function dismiss() {
    setShow(false);
    try { localStorage.setItem(KEY, mondayOfThisWeek()); } catch { /* ignore */ }
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss(); }}>
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center animate-in fade-in zoom-in duration-200">
        <div className="mx-auto w-14 h-14 rounded-full bg-[#164FA3]/10 flex items-center justify-center mb-4">
          <Users size={26} className="text-[#164FA3]" />
        </div>
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600 mb-1">
          <CalendarClock size={13} /> Weekly reminder
        </div>
        <h3 className="text-lg font-bold text-gray-900">Every Monday – Please update Followers.</h3>
        <p className="text-sm text-gray-500 mt-2">
          Keep each page's follower count current so the dashboard totals stay accurate. Open a page and edit its Followers value.
        </p>
        <button
          onClick={dismiss}
          className="mt-5 w-full bg-[#164FA3] hover:bg-blue-800 text-white font-semibold px-4 py-2.5 rounded-lg text-sm"
        >
          Got it
        </button>
        <button
          onClick={dismiss}
          aria-label="Close"
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
