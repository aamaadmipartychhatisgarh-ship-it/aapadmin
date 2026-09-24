"use client";

// Karyakarta Rating (1–10) with a progressively darker green scale. Shared by the
// public registration form (a selectable 1–10 scale) and the admin displays
// (a read-only badge) so the SAME colour always represents the SAME rating
// everywhere it is shown — saved, loaded, edited and displayed consistently.
//
// Tiers (per spec): 1–2 very light · 3–4 light · 5–6 medium · 7–8 stronger ·
// 9 dark · 10 darkest. Values map onto the Tailwind green ramp; text colour flips
// to white once the background is dark enough to keep the number legible.
export function ratingStyle(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1) return null;
  if (v <= 2) return { bg: "#dcfce7", fg: "#166534", border: "#bbf7d0" }; // green-100 — very light
  if (v <= 4) return { bg: "#bbf7d0", fg: "#166534", border: "#86efac" }; // green-200 — light
  if (v <= 6) return { bg: "#4ade80", fg: "#14532d", border: "#22c55e" }; // green-400 — medium
  if (v <= 8) return { bg: "#16a34a", fg: "#ffffff", border: "#15803d" }; // green-600 — stronger
  if (v <= 9) return { bg: "#166534", fg: "#ffffff", border: "#14532d" }; // green-800 — dark
  return { bg: "#14532d", fg: "#ffffff", border: "#052e16" };             // green-900 — darkest (10)
}

// Selectable 1–10 scale. Every button carries its own green shade so the whole
// scale reads at a glance; the chosen rating is highlighted with a ring on top of
// its shade. `value` is the current rating (number, or "" / null for none);
// onChange(n) fires the chosen number, and clicking the selected one clears it.
export function RatingScale({ value, onChange, disabled }) {
  const sel = Number(value) || 0;
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const st = ratingStyle(n);
        const active = sel === n;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(active ? "" : n)}
            aria-pressed={active}
            title={`Rating ${n}`}
            className={`h-9 w-9 rounded-lg text-sm font-bold transition ${active ? "ring-2 ring-offset-1 ring-green-800 scale-110 shadow" : "opacity-85 hover:opacity-100"}`}
            style={{ background: st.bg, color: st.fg, border: `1px solid ${st.border}` }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

// Read-only badge for lists / views / exports — the same green shade as the scale.
export function RatingBadge({ value }) {
  const st = ratingStyle(value);
  if (!st) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-md text-[11px] px-1.5 py-0.5 font-bold"
      style={{ background: st.bg, color: st.fg, border: `1px solid ${st.border}` }}
    >
      {Number(value)}<span className="font-medium opacity-80">/10</span>
    </span>
  );
}
