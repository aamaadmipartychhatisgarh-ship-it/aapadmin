"use client";

import { useState, useEffect } from "react";
import { User } from "lucide-react";

// Backward-compatible photo URL resolution. Legacy records may store a photo
// reference in a non-rooted format (a bare filename, or "uploads/x.jpg" without
// the leading slash) that an <img> can't resolve against the current page.
// Normalize any such value to the canonical "/uploads/<file>" path (served by
// the durable /api/media/[file] route via the next.config rewrite), while
// leaving already-valid values (rooted paths, http(s)/data/blob URLs) untouched.
// This makes existing stored photos display without touching the database.
export function resolvePhotoUrl(src) {
  if (!src || typeof src !== "string") return src || "";
  const s = src.trim();
  if (!s) return "";
  if (/^(https?:|data:|blob:)/i.test(s)) return s; // absolute / inline / object URL
  if (s.startsWith("/")) return s;                 // already rooted (e.g. /uploads/x.jpg)
  // Bare filename or relative legacy path → route through /uploads/.
  return "/uploads/" + s.replace(/^\.?\/*/, "").replace(/^uploads\//i, "");
}

// Initials from a name: first + last word's first letter (e.g. "Dilip Patkar" -> DP).
export function initialsOf(name) {
  if (!name) return "";
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Circular avatar: shows the image when available, else initials, else a user
// icon. Reusable across the app for consistent rendering.
//   name          — used for initials + alt text
//   src           — image URL (optional)
//   size          — px diameter (default 64)
//   className     — extra classes on the circle (background/border/ring)
//   textClassName — classes for the initials/icon (color)
export default function Avatar({ name, src, size = 64, square = false, className = "", textClassName = "", onClick, title }) {
  const [errored, setErrored] = useState(false);
  // Retry attempts (0 = first load). In a large list dozens of photos load at
  // once through the auth+DB-backed /api/media route; under that burst a request
  // can transiently fail (pool/queue pressure). Without a retry it would stick on
  // the initials placeholder forever, so the SAME photo that shows fine elsewhere
  // looks "blank" here. Retry once (cache-busting) before falling back.
  const [retry, setRetry] = useState(0);
  // Reset whenever the image URL changes, so a freshly-uploaded photo replaces
  // the initials immediately instead of staying stuck on a prior failed load.
  useEffect(() => { setErrored(false); setRetry(0); }, [src]);
  const ini = initialsOf(name);
  const resolvedSrc = resolvePhotoUrl(src);
  const finalSrc = retry > 0 && resolvedSrc
    ? `${resolvedSrc}${resolvedSrc.includes("?") ? "&" : "?"}r=${retry}`
    : resolvedSrc;
  const showImg = resolvedSrc && !errored;
  const onImgError = () => { if (retry < 2) setRetry((n) => n + 1); else setErrored(true); };
  return (
    <div
      onClick={onClick}
      title={title}
      style={{ width: size, height: size }}
      className={`${square ? "rounded-xl" : "rounded-full"} shrink-0 overflow-hidden flex items-center justify-center ${onClick ? "cursor-pointer" : ""} ${className}`}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={retry} src={finalSrc} alt={name || "avatar"} loading="lazy" decoding="async" onError={onImgError} className="w-full h-full object-cover" />
      ) : ini ? (
        <span className={`font-bold leading-none ${textClassName}`} style={{ fontSize: Math.round(size * 0.38) }}>{ini}</span>
      ) : (
        <User size={Math.round(size * 0.5)} className={textClassName} />
      )}
    </div>
  );
}
