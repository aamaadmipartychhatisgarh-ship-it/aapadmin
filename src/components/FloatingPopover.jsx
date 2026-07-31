"use client";

import { useState, useLayoutEffect, useEffect } from "react";
import { createPortal } from "react-dom";

// Portal-rendered popover, fixed-positioned from the trigger's own bounding
// rect and clamped to stay fully inside the viewport. Fixes the class of bug
// where `absolute right-0` popovers clip or overlap on narrow screens, or
// disappear/misplace inside a horizontally-scrolled container (a scrolling
// ancestor clips `absolute` overflow, and the trigger's on-screen position
// after scrolling has nothing to do with where `right: 0` lands).
//
//   anchorRef  ref on the trigger element (button/div) this popover hangs off
//   open       whether to render
//   onClose    called on outside click (mousedown outside both the popover
//              and the anchor)
//   align      "right" (popover's right edge meets anchor's right edge,
//              the common menu pattern) or "left"
//   width      popover width in px, used for the clamp math
//   estimatedHeight  rough height in px, used to decide whether to flip the
//              popover above the anchor when there's no room below
export default function FloatingPopover({ anchorRef, open, onClose, align = "right", width = 240, estimatedHeight = 220, children }) {
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) { setPos(null); return; }
    const compute = () => {
      const r = anchorRef.current.getBoundingClientRect();
      const margin = 8;
      let left = align === "right" ? r.right - width : r.left;
      left = Math.min(Math.max(margin, left), window.innerWidth - width - margin);
      const roomBelow = window.innerHeight - r.bottom;
      const flipUp = roomBelow < estimatedHeight && r.top > roomBelow;
      const top = flipUp ? Math.max(margin, r.top - estimatedHeight - 6) : r.bottom + 6;
      setPos({ left, top });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, anchorRef, align, width, estimatedHeight]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (anchorRef?.current?.contains(e.target)) return;
      onClose?.();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, anchorRef, onClose]);

  if (!open || !pos || typeof document === "undefined") return null;
  return createPortal(
    <div
      style={{ position: "fixed", left: pos.left, top: pos.top, width, zIndex: 100 }}
      className="bg-white rounded-xl shadow-xl border border-gray-100"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}
