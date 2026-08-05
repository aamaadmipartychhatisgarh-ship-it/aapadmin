"use client";

import { useState, useEffect } from "react";
import { User } from "lucide-react";

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
  // Reset the error flag whenever the image URL changes, so a freshly-uploaded
  // photo replaces the initials immediately instead of staying stuck on a prior
  // failed/placeholder load until the component remounts.
  useEffect(() => { setErrored(false); }, [src]);
  const ini = initialsOf(name);
  const showImg = src && !errored;
  return (
    <div
      onClick={onClick}
      title={title}
      style={{ width: size, height: size }}
      className={`${square ? "rounded-xl" : "rounded-full"} shrink-0 overflow-hidden flex items-center justify-center ${onClick ? "cursor-pointer" : ""} ${className}`}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name || "avatar"} loading="lazy" decoding="async" onError={() => setErrored(true)} className="w-full h-full object-cover" />
      ) : ini ? (
        <span className={`font-bold leading-none ${textClassName}`} style={{ fontSize: Math.round(size * 0.38) }}>{ini}</span>
      ) : (
        <User size={Math.round(size * 0.5)} className={textClassName} />
      )}
    </div>
  );
}
