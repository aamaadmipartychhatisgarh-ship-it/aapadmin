"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Plus, Camera, Upload, Eye, Trash2, X, ZoomIn, ZoomOut, RotateCcw, RotateCw, RefreshCw, Loader2, CheckCircle2, RectangleHorizontal, RectangleVertical } from "lucide-react";
import Avatar from "@/components/Avatar";

// ONE reusable profile-photo component for the whole app (Caller Dashboard,
// Workers, Contacts, profile pages, active calling card, …). It shows the
// avatar, a "+" menu (Upload / Take Photo / View / Remove), and a touch-friendly
// crop dialog (drag, zoom, rotate, reset) with a live circular preview. The image
// is only uploaded after the user clicks Save; it is cropped square, re-encoded
// (which strips EXIF and bakes in orientation) and compressed toward <300 KB.
//
// Props:
//   name        person name (initials / alt)
//   src         current photo URL (or null)
//   size        avatar px (default 96)
//   square      rounded-square vs circle avatar
//   editable    show the edit affordance + menu (default true)
//   persist     async (blob|null) => url|null — how to store the image. Receives
//               the cropped Blob (upload) or null (remove) and returns the new
//               URL (or null). If omitted, uploads to /api/uploads.
//   onChange    (url|null) => void — fired after a successful save/remove
//   className / textClassName / ringClassName — styling passthroughs

const ACCEPT = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_OUT = 500;  // longer output side, px
const MAX_VIEW = 288; // longer on-screen viewport side, px

// Selectable crop ratios. w:h is the "portrait" reading (e.g. 4:5 = 4 wide,
// 5 tall) — the Horizontal/Vertical toggle swaps them. 1:1 has no orientation.
const RATIOS = [
  { key: "1:1", label: "1:1", w: 1, h: 1 },
  { key: "2:3", label: "2:3", w: 2, h: 3 },
  { key: "3:4", label: "3:4", w: 3, h: 4 },
  { key: "4:5", label: "4:5", w: 4, h: 5 },
  { key: "9:16", label: "9:16", w: 9, h: 16 },
  { key: "custom", label: "Custom", w: 1, h: 1 },
];

async function defaultUpload(blob) {
  const fd = new FormData();
  fd.append("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
  const r = await fetch("/api/uploads", { method: "POST", body: fd });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || "Upload failed");
  return d.url;
}

// Encode a canvas to a JPEG Blob, stepping quality down until it fits <~300 KB.
async function toCompressedJpeg(canvas) {
  const target = 300 * 1024;
  let quality = 0.9;
  let blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
  while (blob && blob.size > target && quality > 0.5) {
    quality -= 0.1;
    blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality)); // eslint-disable-line no-await-in-loop
  }
  return blob;
}

export default function ProfilePhoto({
  name,
  src,
  size = 96,
  square = false,
  editable = true,
  persist,
  onChange,
  className = "bg-[#164FA3]/10",
  textClassName = "text-[#164FA3]",
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [cropSrc, setCropSrc] = useState(null); // dataURL being cropped
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null); // { type, text }
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const cameraRef = useRef(null);

  const flash = (type, text) => { setToast({ type, text }); setTimeout(() => setToast(null), 2500); };

  function pick(file) {
    setErr("");
    if (!file) return;
    if (!ACCEPT.includes(file.type)) { flash("error", "Unsupported file type. Use JPG, PNG or WEBP."); return; }
    if (file.size > MAX_BYTES) { flash("error", "Maximum size is 10 MB."); return; }
    const fr = new FileReader();
    fr.onload = () => setCropSrc(fr.result);
    fr.onerror = () => flash("error", "Could not read the image.");
    fr.readAsDataURL(file);
  }

  async function handleCropped(blob) {
    setSaving(true);
    setErr("");
    try {
      const url = persist ? await persist(blob) : await defaultUpload(blob);
      onChange?.(url);
      setCropSrc(null);
      flash("success", "Profile photo updated successfully.");
    } catch (e) {
      setErr(e?.message || "Image upload failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setMenuOpen(false);
    setSaving(true);
    try {
      if (persist) await persist(null);
      onChange?.(null);
      flash("success", "Profile photo removed.");
    } catch (e) {
      flash("error", e?.message || "Could not remove the photo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative inline-block">
      <Avatar name={name} src={src} size={size} square={square} className={className} textClassName={textClassName} />

      {editable && (
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          disabled={saving}
          title="Change profile photo"
          className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-[#164FA3] text-white flex items-center justify-center shadow-md ring-2 ring-white hover:bg-blue-800 disabled:opacity-60"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={16} />}
        </button>
      )}

      {/* Options menu */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute z-50 mt-2 left-1/2 -translate-x-1/2 top-full w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-1 text-sm">
            <MenuItem icon={Upload} label="Upload Photo" onClick={() => { setMenuOpen(false); fileRef.current?.click(); }} />
            <MenuItem icon={Camera} label="Take Photo" onClick={() => { setMenuOpen(false); cameraRef.current?.click(); }} />
            {src && <MenuItem icon={Eye} label="View Current Photo" onClick={() => { setMenuOpen(false); setViewing(true); }} />}
            {src && <MenuItem icon={Trash2} label="Remove Photo" danger onClick={handleRemove} />}
            <MenuItem icon={X} label="Cancel" onClick={() => setMenuOpen(false)} />
          </div>
        </>
      )}

      {/* Hidden inputs: gallery + camera */}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />

      {/* Crop dialog */}
      {cropSrc && (
        <CropDialog
          src={cropSrc}
          saving={saving}
          error={err}
          onCancel={() => { setCropSrc(null); setErr(""); }}
          onSave={handleCropped}
        />
      )}

      {/* Full-image viewer */}
      {viewing && src && createPortal(
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={() => setViewing(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={name || "photo"} className="max-w-[90vw] max-h-[90vh] rounded-xl object-contain" />
          <button className="absolute top-4 right-4 text-white/80 hover:text-white" onClick={() => setViewing(false)}><X size={28} /></button>
        </div>,
        document.body
      )}

      {/* Toast */}
      {toast && createPortal(
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.type === "success" ? <CheckCircle2 size={16} /> : <X size={16} />} {toast.text}
        </div>,
        document.body
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 text-left ${danger ? "text-red-600" : "text-gray-700"}`}>
      <Icon size={15} /> {label}
    </button>
  );
}

// --- Crop dialog: pick an aspect ratio + orientation, then drag/zoom/rotate ---
function CropDialog({ src, onCancel, onSave, saving, error }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [ratioKey, setRatioKey] = useState("1:1");
  const [orientation, setOrientation] = useState("portrait"); // portrait | landscape
  const [customW, setCustomW] = useState(1);
  const [customH, setCustomH] = useState(1);
  const drag = useRef(null);

  const ratioDef = RATIOS.find((r) => r.key === ratioKey) || RATIOS[0];
  const isSquare = ratioKey === "1:1";
  const isCustom = ratioKey === "custom";
  // Preset ratios are stored "portrait" (w<h); the orientation toggle swaps
  // them. Custom is entered literally as width:height, so it already encodes
  // orientation directly — the toggle doesn't apply (and stays hidden for it).
  const ratio = isSquare
    ? 1
    : isCustom
    ? Math.max(1, Number(customW) || 1) / Math.max(1, Number(customH) || 1)
    : orientation === "landscape" ? ratioDef.h / ratioDef.w : ratioDef.w / ratioDef.h;

  // On-screen viewport size that fits MAX_VIEW while honoring the ratio.
  const viewW = ratio >= 1 ? MAX_VIEW : Math.max(120, Math.round(MAX_VIEW * ratio));
  const viewH = ratio >= 1 ? Math.max(120, Math.round(MAX_VIEW / ratio)) : MAX_VIEW;
  // Output pixel size at the same ratio, capped to MAX_OUT on the long side.
  const outW = ratio >= 1 ? MAX_OUT : Math.round(MAX_OUT * ratio);
  const outH = ratio >= 1 ? Math.round(MAX_OUT / ratio) : MAX_OUT;

  // Changing ratio/orientation invalidates the old pan offset (frame shape changed).
  useEffect(() => { setOffset({ x: 0, y: 0 }); }, [ratioKey, orientation, customW, customH]);

  // Load the image (createImageBitmap corrects EXIF orientation when supported).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(src);
        const blob = await res.blob();
        let bmp;
        try { bmp = await createImageBitmap(blob, { imageOrientation: "from-image" }); }
        catch { bmp = await createImageBitmap(blob); }
        if (alive) { imgRef.current = bmp; setReady(true); }
      } catch {
        const im = new Image();
        im.onload = () => { if (alive) { imgRef.current = im; setReady(true); } };
        im.src = src;
      }
    })();
    return () => { alive = false; };
  }, [src]);

  // "Cover" scale so the image always fills the crop rect regardless of its
  // aspect ratio, accounting for 90°-multiple rotations swapping W/H.
  const baseScale = useCallback((frameW, frameH) => {
    const img = imgRef.current;
    if (!img) return 1;
    const rotated = ((rotation / 90) % 2 + 2) % 2 === 1; // true for ±90, ±270…
    const effW = rotated ? img.height : img.width;
    const effH = rotated ? img.width : img.height;
    return Math.max(frameW / effW, frameH / effH);
  }, [rotation]);

  const render = useCallback((ctx, dimW, dimH) => {
    const img = imgRef.current;
    if (!img) return;
    const r = dimW / viewW;
    const s = baseScale(viewW, viewH) * zoom * r;
    ctx.clearRect(0, 0, dimW, dimH);
    ctx.save();
    ctx.translate(dimW / 2 + offset.x * r, dimH / 2 + offset.y * r);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(s, s);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  }, [zoom, rotation, offset, baseScale, viewW, viewH]);

  // Redraw the live preview whenever anything changes.
  useEffect(() => {
    if (!ready) return;
    const cv = canvasRef.current;
    if (cv) render(cv.getContext("2d"), viewW, viewH);
  }, [ready, render, viewW, viewH]);

  // Pointer drag.
  const onDown = (e) => {
    const p = "touches" in e ? e.touches[0] : e;
    drag.current = { x: p.clientX, y: p.clientY, ox: offset.x, oy: offset.y };
  };
  const onMove = (e) => {
    if (!drag.current) return;
    const p = "touches" in e ? e.touches[0] : e;
    setOffset({ x: drag.current.ox + (p.clientX - drag.current.x), y: drag.current.oy + (p.clientY - drag.current.y) });
  };
  const onUp = () => { drag.current = null; };

  const reset = () => { setZoom(1); setRotation(0); setOffset({ x: 0, y: 0 }); };

  async function save() {
    const out = document.createElement("canvas");
    out.width = outW; out.height = outH;
    render(out.getContext("2d"), outW, outH);
    const blob = await toCompressedJpeg(out);
    if (blob) onSave(blob);
  }

  return createPortal(
    <div className="fixed inset-0 z-[65] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-900">Crop Photo</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>

        {/* Aspect ratio picker */}
        <div className="mb-3">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Aspect ratio</div>
          <div className="flex flex-wrap gap-1.5">
            {RATIOS.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRatioKey(r.key)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                  ratioKey === r.key ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-600 border-gray-200 hover:border-[#164FA3]"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {isCustom && (
          <div className="mb-3 flex items-center gap-2">
            <input type="number" min="1" value={customW} onChange={(e) => setCustomW(e.target.value)} className="w-16 h-8 px-2 rounded-lg border border-gray-200 text-sm text-center" />
            <span className="text-gray-400 text-sm">:</span>
            <input type="number" min="1" value={customH} onChange={(e) => setCustomH(e.target.value)} className="w-16 h-8 px-2 rounded-lg border border-gray-200 text-sm text-center" />
            <span className="text-xs text-gray-400">width : height</span>
          </div>
        )}

        {!isSquare && !isCustom && (
          <div className="mb-3 flex items-center gap-2">
            <button type="button" onClick={() => setOrientation("portrait")}
              className={`flex-1 h-8 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5 ${orientation === "portrait" ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-600 border-gray-200"}`}>
              <RectangleVertical size={14} /> Vertical
            </button>
            <button type="button" onClick={() => setOrientation("landscape")}
              className={`flex-1 h-8 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5 ${orientation === "landscape" ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-600 border-gray-200"}`}>
              <RectangleHorizontal size={14} /> Horizontal
            </button>
          </div>
        )}

        {/* Crop viewport with a guide overlay matching the chosen ratio */}
        <div
          className="relative mx-auto rounded-xl overflow-hidden bg-gray-900 touch-none select-none"
          style={{ width: viewW, height: viewH, maxWidth: "100%" }}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
          onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
        >
          {!ready && <div className="absolute inset-0 flex items-center justify-center text-white/70"><Loader2 className="animate-spin" /></div>}
          <canvas ref={canvasRef} width={viewW} height={viewH} className="block cursor-move" />
          {/* Frame guide */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className={`border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] ${isSquare ? "rounded-full" : "rounded-md"}`}
              style={{ width: viewW - 8, height: viewH - 8 }}
            />
          </div>
        </div>

        {/* Controls */}
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <ZoomOut size={16} className="text-gray-500 shrink-0" />
            <input type="range" min="1" max="4" step="0.01" value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-[#164FA3]" />
            <ZoomIn size={16} className="text-gray-500 shrink-0" />
          </div>
          <div className="flex items-center justify-center gap-2">
            <CtlBtn onClick={() => setZoom((z) => Math.min(4, z + 0.2))} title="Zoom in"><ZoomIn size={16} /></CtlBtn>
            <CtlBtn onClick={() => setZoom((z) => Math.max(1, z - 0.2))} title="Zoom out"><ZoomOut size={16} /></CtlBtn>
            <CtlBtn onClick={() => setRotation((r) => r - 90)} title="Rotate left"><RotateCcw size={16} /></CtlBtn>
            <CtlBtn onClick={() => setRotation((r) => r + 90)} title="Rotate right"><RotateCw size={16} /></CtlBtn>
            <CtlBtn onClick={reset} title="Reset"><RefreshCw size={16} /></CtlBtn>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} disabled={saving} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50">Cancel</button>
          <button onClick={save} disabled={saving || !ready}
            className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold inline-flex items-center gap-2">
            {saving ? <><Loader2 size={15} className="animate-spin" /> Uploading…</> : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function CtlBtn({ onClick, title, children }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="w-9 h-9 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 flex items-center justify-center">
      {children}
    </button>
  );
}
