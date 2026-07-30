"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  DndContext, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove,
  verticalListSortingStrategy, sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoreVertical, Pin, PinOff, Star, Lock, RotateCcw, Search, X } from "lucide-react";

// Customizable sidebar navigation. Preserves the exact AAP link markup and adds:
// drag-to-reorder (dnd-kit — pointer/touch/keyboard), pin to top/bottom, favourites,
// locked items, search, reset, and per-user persistence. Layout is keyed by the
// stable menu href (never array indexes) and merged with the role default so new
// menu items appear and removed ones drop out.
const GROUPS = ["fav", "top", "main", "bottom"];

function reconcile(items, prefs, lockedHref) {
  const movable = items.filter((i) => i.href !== lockedHref);
  const byHref = Object.fromEntries(movable.map((i) => [i.href, i]));
  const known = new Set(movable.map((i) => i.href));
  const groups = { fav: [], top: [], main: [], bottom: [] };
  const placed = new Set();
  if (prefs) {
    for (const g of GROUPS) {
      for (const href of prefs[g] || []) {
        if (known.has(href) && !placed.has(href)) { groups[g].push(href); placed.add(href); }
      }
    }
  }
  for (const i of movable) if (!placed.has(i.href)) groups.main.push(i.href); // new items → main
  return { groups, byHref };
}

export default function SidebarNav({ items, pathname, onNavigate }) {
  const lockedHref = items[0]?.href || null; // primary landing item is locked on top
  const lockedItem = items.find((i) => i.href === lockedHref) || null;

  const [groups, setGroups] = useState({ fav: [], top: [], main: [], bottom: [] });
  const [byHref, setByHref] = useState({});
  const [q, setQ] = useState("");
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // click still navigates
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }), // long-press on mobile
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Load saved layout once, reconciled against this role's default items.
  useEffect(() => {
    let alive = true;
    fetch("/api/sidebar/preferences")
      .then((r) => r.json())
      .then((d) => { if (!alive) return; const { groups, byHref } = reconcile(items, d?.prefs, lockedHref); setGroups(groups); setByHref(byHref); })
      .catch(() => { const { groups, byHref } = reconcile(items, null, lockedHref); setGroups(groups); setByHref(byHref); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [/* role items identity */ items.map((i) => i.href).join("|")]);

  // Debounced auto-save after any change (once loaded).
  const persist = useCallback((next) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/sidebar/preferences", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs: next }),
      }).catch(() => {});
    }, 500);
  }, []);

  const apply = (next) => { setGroups(next); persist(next); };

  const groupOf = (href) => GROUPS.find((g) => groups[g].includes(href));

  function onDragEnd(e) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const g = groupOf(active.id);
    if (!g || !groups[g].includes(over.id)) return; // only reorder within the same group
    const from = groups[g].indexOf(active.id);
    const to = groups[g].indexOf(over.id);
    apply({ ...groups, [g]: arrayMove(groups[g], from, to) });
  }

  // Move an href into a target group (removing it from the others).
  const moveTo = (href, target) => {
    const next = {};
    for (const g of GROUPS) next[g] = groups[g].filter((h) => h !== href);
    next[target] = [...next[target], href];
    apply(next);
  };
  const toggleFav = (href) => (groupOf(href) === "fav" ? moveTo(href, "main") : moveTo(href, "fav"));

  async function reset() {
    await fetch("/api/sidebar/preferences", { method: "DELETE" }).catch(() => {});
    const { groups } = reconcile(items, null, lockedHref);
    setGroups(groups);
  }

  // Search mode: flat filtered list, no drag.
  const query = q.trim().toLowerCase();
  const searching = query.length > 0;
  const matches = (href) => byHref[href]?.name.toLowerCase().includes(query);

  const renderRow = (href, { fav } = {}) => {
    const item = byHref[href];
    if (!item) return null;
    return (
      <SortableRow
        key={href} item={item} pathname={pathname} onNavigate={onNavigate}
        favorited={groupOf(href) === "fav"} group={groupOf(href)} disabled={searching}
        onPinTop={() => moveTo(href, "top")} onPinBottom={() => moveTo(href, "bottom")}
        onUnpin={() => moveTo(href, "main")} onToggleFav={() => toggleFav(href)}
      />
    );
  };

  const hasPinnedTop = groups.fav.length + groups.top.length > 0;
  const hasBottom = groups.bottom.length > 0;

  return (
    <nav className="flex-1 py-4 overflow-y-auto flex flex-col">
      {/* Sidebar search */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-blue-300 pointer-events-none" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search menu…"
            className="w-full h-8 pl-8 pr-7 rounded-md bg-white/10 text-white placeholder:text-blue-300 text-sm outline-none focus:bg-white/15"
          />
          {q && <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-300 hover:text-white"><X size={14} /></button>}
        </div>
      </div>

      {/* Locked primary item (always on top, not draggable) */}
      {lockedItem && (!searching || lockedItem.name.toLowerCase().includes(query)) && (
        <NavLink item={lockedItem} isActive={pathname === lockedItem.href} onNavigate={onNavigate} locked />
      )}

      {searching ? (
        // Flat filtered results (no drag while searching)
        [...groups.fav, ...groups.top, ...groups.main, ...groups.bottom]
          .filter(matches)
          .map((href) => <NavLink key={href} item={byHref[href]} isActive={pathname === byHref[href]?.href} onNavigate={onNavigate} />)
      ) : loaded ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          {/* Favourites + Pinned top */}
          <SortableContext items={groups.fav} strategy={verticalListSortingStrategy}>
            {groups.fav.map((h) => renderRow(h))}
          </SortableContext>
          <SortableContext items={groups.top} strategy={verticalListSortingStrategy}>
            {groups.top.map((h) => renderRow(h))}
          </SortableContext>
          {hasPinnedTop && <div className="mx-6 my-2 border-t border-white/10" />}

          {/* Main (freely orderable) */}
          <SortableContext items={groups.main} strategy={verticalListSortingStrategy}>
            {groups.main.map((h) => renderRow(h))}
          </SortableContext>

          {/* Pinned bottom */}
          {hasBottom && <div className="mx-6 my-2 border-t border-white/10" />}
          <SortableContext items={groups.bottom} strategy={verticalListSortingStrategy}>
            {groups.bottom.map((h) => renderRow(h))}
          </SortableContext>
        </DndContext>
      ) : null}

      {/* Reset */}
      <div className="mt-auto px-4 pt-3">
        <button onClick={reset} className="flex items-center gap-2 text-[11px] text-blue-300 hover:text-white transition-colors">
          <RotateCcw size={12} /> Reset sidebar
        </button>
      </div>
    </nav>
  );
}

// The exact AAP link row (reused for locked + search results). `dragProps` and
// `extra` let the sortable version overlay a grip + kebab without changing markup.
function NavLink({ item, isActive, onNavigate, locked, innerRef, style, dragAttrs, dragListeners, extra }) {
  const Icon = item.icon;
  return (
    <div ref={innerRef} style={style} className="relative group/navitem">
      <Link
        href={item.href}
        onClick={onNavigate}
        className={`flex items-center gap-3 px-6 py-3 transition-all ${
          isActive
            ? "bg-[#1d4c94] text-white border-l-4 border-white font-semibold"
            : "text-blue-100 hover:text-white hover:bg-white/5 border-l-4 border-transparent font-medium"
        }`}
      >
        <Icon size={20} className={isActive ? "text-white" : "text-blue-200"} />
        <span className="flex-1 truncate">{item.name}</span>
        {locked && <Lock size={13} className="text-blue-300/70 shrink-0" />}
      </Link>
      {/* Drag handle (hover) */}
      {dragListeners && (
        <button
          {...dragAttrs} {...dragListeners}
          aria-label="Drag to reorder"
          className="absolute left-1 top-1/2 -translate-y-1/2 text-blue-300/60 hover:text-white opacity-0 group-hover/navitem:opacity-100 cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical size={14} />
        </button>
      )}
      {extra}
    </div>
  );
}

function SortableRow({ item, pathname, onNavigate, favorited, group, disabled, onPinTop, onPinBottom, onUnpin, onToggleFav }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.href, disabled });
  const [menuOpen, setMenuOpen] = useState(false);
  const isActive = pathname === item.href;
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 50 : "auto" };

  const kebab = (
    <>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen((o) => !o); }}
        aria-label="Menu options"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-300/70 hover:text-white opacity-0 group-hover/navitem:opacity-100"
      >
        <MoreVertical size={16} />
      </button>
      {favorited && <Star size={12} className="absolute right-8 top-1/2 -translate-y-1/2 text-[#FCB712] fill-[#FCB712]" />}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-2 top-[calc(50%+14px)] z-50 w-40 bg-white rounded-lg shadow-xl py-1 text-sm text-gray-700">
            <MenuItem icon={Star} label={favorited ? "Unfavorite" : "Favorite"} onClick={() => { onToggleFav(); setMenuOpen(false); }} />
            <MenuItem icon={Pin} label="Pin to Top" onClick={() => { onPinTop(); setMenuOpen(false); }} />
            <MenuItem icon={Pin} label="Pin to Bottom" onClick={() => { onPinBottom(); setMenuOpen(false); }} />
            {group !== "main" && <MenuItem icon={PinOff} label="Unpin" onClick={() => { onUnpin(); setMenuOpen(false); }} />}
          </div>
        </>
      )}
    </>
  );

  return (
    <div onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}>
      <NavLink
        item={item} isActive={isActive} onNavigate={onNavigate}
        innerRef={setNodeRef} style={style} dragAttrs={attributes} dragListeners={listeners} extra={kebab}
      />
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 text-left">
      <Icon size={14} /> {label}
    </button>
  );
}
