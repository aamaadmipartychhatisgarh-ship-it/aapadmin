"use client";

import { useEffect, useSyncExternalStore, useState } from "react";
import { useSession } from "next-auth/react";
import { FileText, Share2, Link2, Download, X, Loader2, Copy, Mail, MessageCircle, Check } from "lucide-react";

// ============================================================================================================
// COMMON PDF SHARING — one system for every PDF the app exports, present and future.
//
// Every PDF export ends in one of two ways, and both are caught HERE, centrally, without per-module code:
//   1. In-page generation: the page builds a Blob and downloads it through <a download href="blob:..."> (.click()).
//      The blobs the page creates are remembered (URL.createObjectURL), and a PDF download is recognised when its anchor
//      is clicked - programmatically (HTMLAnchorElement.prototype.click, even for anchors never added to the page) or by
//      the user. The download itself happens exactly as before.
//   2. A plain link to a PDF export endpoint (<a href="/api/...?format=pdf">, /export/pdf, /api/supervisor/export/...).
//      The click is taken over: the PDF is fetched with the user's session, saved under the server's file name (the
//      same download as before) and kept. A link that turns out not to return a PDF is simply saved as its file.
// The EXACT generated PDF is then kept (a File) and a "PDF ready" panel offers:
//   - Share PDF   — the native share sheet with the actual PDF file (WhatsApp, Email, Drive, Bluetooth, ... whatever
//                   the device offers) via navigator.canShare({ files }) / navigator.share. Shown only when supported.
//   - Share link  — where the device cannot share files (most desktop browsers): the same PDF is uploaded once to a
//                   secure, expiring link (/api/pdf-share, 7 days, signed-in users) which can be copied, sent on
//                   WhatsApp, emailed, or passed to the native share sheet as a link. Nothing claims the file was
//                   attached when only a link was sent.
//   - Download again — the same file again (never regenerated).
// Only the latest PDF is kept: a new export replaces it (its name is always shown), so a previous module's PDF can
// never be shared by mistake. New code may also call deliverPdf(blob, filename) directly.
// ============================================================================================================

const PDF_MIME = "application/pdf";
const state = { status: "idle", file: null, filename: "", size: 0, at: null, error: "", seq: 0 };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
function setState(patch) { Object.assign(state, patch, { seq: state.seq + 1 }); snapshot = { ...state }; emit(); }
let snapshot = { ...state };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getSnapshot = () => snapshot;
const getServerSnapshot = () => snapshot;

let origClick = null;
let origCreate = null;
const blobsByUrl = new Map();                       // blob: URL -> Blob (only the most recent ones)

const isPdfName = (n) => /\.pdf$/i.test(String(n || ""));
function cleanName(n) {
  let s = String(n || "").replace(/[\r\n"\\/<>:|?*\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) s = "document";
  return isPdfName(s) ? s : `${s}.pdf`;
}

// The exact PDF just generated: keep it and show the share panel. `download` = also save it (when the caller has not).
export function deliverPdf(blob, filename, { download = true } = {}) {
  if (!blob) return;
  const name = cleanName(filename);
  const file = new File([blob], name, { type: PDF_MIME, lastModified: Date.now() });
  if (download) saveFile(file, name);
  setState({ status: "ready", file, filename: name, size: file.size, at: new Date(), error: "" });
}

function saveFile(blob, name) {
  const url = (origCreate || URL.createObjectURL).call(URL, blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener"; a.dataset.pdfshareInternal = "1";
  document.body.appendChild(a);
  (origClick || HTMLAnchorElement.prototype.click).call(a);
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// A same-origin export endpoint that delivers a PDF.
function isPdfExportUrl(u) {
  if (u.origin !== window.location.origin) return false;
  const p = u.pathname;
  if (!p.startsWith("/api/")) return false;
  if (p.startsWith("/api/pdf-share/") || p.startsWith("/api/media/")) return false;     // shared links / uploaded documents
  return u.searchParams.get("format") === "pdf" || /\/pdf(\/|$)/i.test(p) || /\.pdf$/i.test(p) || p.startsWith("/api/supervisor/export/");
}

function filenameFrom(res, url) {
  const cd = res.headers.get("content-disposition") || "";
  const star = cd.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")); } catch { /* fall through */ } }
  const plain = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (plain) return plain[1].trim();
  const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "document");
  return last;
}

async function fetchAndDeliver(href) {
  setState({ status: "loading", file: null, filename: "", size: 0, error: "" });
  try {
    const res = await fetch(href, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) {
      let msg = `The PDF could not be generated (error ${res.status}).`;
      try { const ct = res.headers.get("content-type") || ""; if (/json/.test(ct)) msg = (await res.json()).message || msg; } catch { /* keep */ }
      setState({ status: "error", error: msg });
      return;
    }
    const blob = await res.blob();
    const name = filenameFrom(res, href);
    const ct = (res.headers.get("content-type") || blob.type || "").toLowerCase();
    if (!ct.includes("pdf")) {                    // not a PDF after all: save it as the file it is, like the link did before
      saveFile(blob, name);
      setState({ status: "idle", file: null });
      return;
    }
    if (!blob.size) { setState({ status: "error", error: "The PDF came back empty. Adjust the selection and try again." }); return; }
    deliverPdf(blob, name);
  } catch {
    setState({ status: "error", error: "The PDF could not be downloaded — network error. Please try again." });
  }
}

function installHooks() {
  if (typeof window === "undefined" || window.__pdfShareInstalled) return;
  window.__pdfShareInstalled = true;
  origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  URL.createObjectURL = function (obj) {
    const url = origCreate.call(URL, obj);
    if (obj instanceof Blob) {
      blobsByUrl.set(url, obj);
      if (blobsByUrl.size > 40) blobsByUrl.delete(blobsByUrl.keys().next().value);
    }
    return url;
  };
  URL.revokeObjectURL = function (url) { setTimeout(() => blobsByUrl.delete(url), 5000); return origRevoke.call(URL, url); };

  // An anchor that downloads a PDF blob: let the download happen, then keep that same PDF for sharing.
  const offerFromAnchor = (a) => {
    if (!a || a.dataset?.pdfshareInternal || a.dataset?.noPdfShare) return;
    const href = a.getAttribute("href") || "";
    if (!a.hasAttribute("download") || !href.startsWith("blob:")) return;
    const blob = blobsByUrl.get(href);
    if (!blob) return;
    const name = a.getAttribute("download") || "";
    if (blob.type === PDF_MIME || (isPdfName(name) && (!blob.type || /octet-stream|pdf/i.test(blob.type)))) {
      deliverPdf(blob, name || "document.pdf", { download: false });
    }
  };
  origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (...args) {
    const r = origClick.apply(this, args);
    try { offerFromAnchor(this); } catch { /* never break a download */ }
    return r;
  };

  // A user's own click on a PDF link (or on a blob download link).
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target?.closest?.("a[href]");
    if (!a || a.dataset.pdfshareInternal || a.dataset.noPdfShare) return;
    const href = a.getAttribute("href") || "";
    if (href.startsWith("blob:")) { if (e.isTrusted) setTimeout(() => offerFromAnchor(a), 0); return; }
    let u; try { u = new URL(href, window.location.href); } catch { return; }
    if (!isPdfExportUrl(u)) return;
    e.preventDefault();
    fetchAndDeliver(u.toString());
  }, true);
}

function fmtSize(n) {
  if (!n) return "";
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export default function PdfShareCenter() {
  useEffect(() => { installHooks(); }, []);
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { status: authStatus } = useSession();
  const signedIn = authStatus === "authenticated";
  const [link, setLink] = useState(null);           // { url, seq } for the current PDF
  const [linkBusy, setLinkBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);

  // A new PDF resets everything belonging to the previous one.
  useEffect(() => { setLink(null); setMsg(""); setCopied(false); }, [s.file]);

  if (s.status === "idle") return null;
  const close = () => setState({ status: "idle", file: null });

  const canShareFile = !!(s.file && typeof navigator !== "undefined" && navigator.canShare && (() => { try { return navigator.canShare({ files: [s.file] }); } catch { return false; } })());
  const canShareUrl = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const curLink = link && link.file === s.file ? link.url : null;

  async function shareFile() {
    setMsg("");
    try {
      await navigator.share({ files: [s.file], title: s.filename, text: s.filename });
    } catch (e) {
      if (e?.name === "AbortError") return;              // the user closed the share sheet
      setMsg(signedIn ? "This device could not share the file. Use Share link instead." : "This device could not share the file. Attach it from your Downloads instead.");
    }
  }
  async function makeLink() {
    if (linkBusy) return;
    setLinkBusy(true); setMsg("");
    const file = s.file;
    try {
      const r = await fetch("/api/pdf-share", { method: "POST", headers: { "Content-Type": PDF_MIME, "X-Filename": encodeURIComponent(s.filename) }, body: file });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.path) { setMsg(d.message || "Could not create the share link."); return; }
      setLink({ url: new URL(d.path, window.location.origin).toString(), file });
    } catch { setMsg("Could not create the share link — network error."); }
    finally { setLinkBusy(false); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(curLink); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setMsg("Copy failed — select the link and copy it manually."); }
  }
  const linkText = curLink ? `${s.filename}\n${curLink}` : "";
  const btn = "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold";
  const primary = `${btn} bg-[#164FA3] text-white hover:bg-blue-800 disabled:opacity-60`;
  const secondary = `${btn} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60`;

  return (
    <div role="dialog" aria-label="PDF ready" data-testid="pdf-share-panel" data-status={s.status}
      className="no-print fixed z-[300] bottom-3 left-3 right-3 sm:left-auto sm:right-4 sm:bottom-4 sm:w-[380px] bg-white border border-gray-200 rounded-2xl shadow-2xl p-3.5">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${s.status === "error" ? "bg-red-50 text-red-600" : "bg-[#164FA3]/10 text-[#164FA3]"}`}>
          {s.status === "loading" ? <Loader2 size={20} className="animate-spin" /> : <FileText size={20} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gray-900">{s.status === "loading" ? "Preparing PDF…" : s.status === "error" ? "PDF export failed" : "PDF downloaded"}</div>
          {s.status === "ready" && <div className="text-xs text-gray-600 truncate" title={s.filename} data-testid="pdf-share-filename">{s.filename}{s.size ? ` · ${fmtSize(s.size)}` : ""}</div>}
          {s.status === "error" && <div className="text-xs text-red-600 break-words">{s.error}</div>}
        </div>
        <button type="button" onClick={close} aria-label="Close" className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100"><X size={16} /></button>
      </div>

      {s.status === "ready" && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            {canShareFile && (
              <button type="button" onClick={shareFile} className={primary} data-testid="pdf-share-file"><Share2 size={15} /> Share PDF</button>
            )}
            {signedIn && !curLink && (
              <button type="button" onClick={makeLink} disabled={linkBusy} className={canShareFile ? secondary : primary} data-testid="pdf-share-link">
                {linkBusy ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} Share link
              </button>
            )}
            <button type="button" onClick={() => saveFile(s.file, s.filename)} className={secondary} data-testid="pdf-share-download"><Download size={15} /> Download again</button>
          </div>

          {curLink && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-2.5 space-y-2" data-testid="pdf-share-linkbox">
              <input readOnly value={curLink} onFocus={(e) => e.target.select()} aria-label="Share link" data-testid="pdf-share-url"
                className="w-full h-8 px-2 rounded-md border border-gray-200 bg-white text-xs text-gray-700" />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copyLink} className={secondary} data-testid="pdf-share-copy">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy link"}</button>
                <a href={`https://wa.me/?text=${encodeURIComponent(linkText)}`} target="_blank" rel="noopener noreferrer" data-no-pdf-share="1" className={secondary} data-testid="pdf-share-whatsapp"><MessageCircle size={15} /> WhatsApp</a>
                <a href={`mailto:?subject=${encodeURIComponent(s.filename)}&body=${encodeURIComponent(`Please open the PDF "${s.filename}" here (link valid for 7 days):\n${curLink}`)}`} data-no-pdf-share="1" className={secondary} data-testid="pdf-share-email"><Mail size={15} /> Email</a>
                {canShareUrl && !canShareFile && (
                  <button type="button" onClick={() => navigator.share({ title: s.filename, text: s.filename, url: curLink }).catch(() => {})} className={secondary} data-testid="pdf-share-more"><Share2 size={15} /> More…</button>
                )}
              </div>
              <div className="text-[11px] text-gray-500">The link opens this exact PDF. Anyone with the link can open it for 7 days. WhatsApp and Email send the link, not an attached file.</div>
            </div>
          )}

          {!canShareFile && !signedIn && (
            <div className="text-[11px] text-gray-500" data-testid="pdf-share-unsupported">This browser cannot share files. The PDF was downloaded — attach it from your Downloads to share it.</div>
          )}
          {msg && <div className="text-xs text-red-600">{msg}</div>}
        </div>
      )}
    </div>
  );
}
