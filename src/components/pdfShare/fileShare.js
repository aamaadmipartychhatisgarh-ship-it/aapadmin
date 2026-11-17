// ============================================================================================================
// COMMON FILE SHARING — one system for every PDF / Excel / CSV the app exports or prints, present and future.
//
// How files reach it (no per-module share code):
//   1. In-page downloads: a page builds a Blob and downloads it through <a download href="blob:..."> (.click()). The blobs the
//      page creates are remembered (URL.createObjectURL) and a PDF/Excel/CSV download is recognised when its anchor is
//      clicked — programmatically (HTMLAnchorElement.prototype.click, even for anchors never added to the page; this also
//      covers XLSX.writeFile) or by the user. The download itself happens exactly as before.
//   2. Plain links to an export endpoint (<a href="/api/...?format=pdf|xlsx|csv">, /export/xlsx, /export ...): the click is
//      taken over, the file is fetched with the user's session, saved under the server's file name (the same download as
//      before) and kept. A response that is not a PDF/Excel/CSV is simply saved as the file it is.
//   3. Print that uses a PDF: a PDF blob opened for printing (window.open(blob:) — e.g. Contacts → Print) is kept too.
//   4. Explicit: shareGenerated(generator) — "Share" buttons beside Print (CommonPDFExportButton, Reports, Unfiltered Contacts,
//      Leader Assessment) generate the same file the export/print produces and offer it without downloading; and
//      offerFile(blob, filename) for any new feature.
// The EXACT file is then kept (a File with its original name and MIME type) and the share panel (FileShareCenter) offers the
// native share sheet with the file (only where navigator.canShare({ files }) says yes), a secure sign-in-only link otherwise,
// and Download again. Only the latest file is kept; signing out or switching user clears it.
// ============================================================================================================

export const FILE_TYPES = {
  pdf: { mime: "application/pdf", label: "PDF" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel" },
  xls: { mime: "application/vnd.ms-excel", label: "Excel" },
  csv: { mime: "text/csv", label: "CSV" },
};

const state = { status: "idle", file: null, kind: null, filename: "", size: 0, at: null, error: "", origin: "download", note: "" };
let snapshot = { ...state };
const listeners = new Set();
function setState(patch) { Object.assign(state, patch); snapshot = { ...state }; listeners.forEach((l) => l()); }
export const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
export const getSnapshot = () => snapshot;
export const clearShare = () => setState({ status: "idle", file: null, kind: null, filename: "", size: 0, error: "", note: "" });
export const setShareNote = (note) => setState({ note });

let origClick = null;
let origCreate = null;
const blobsByUrl = new Map();                       // blob: URL -> Blob (only the most recent ones)

const extOf = (n) => (String(n || "").match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "";
// PDF / Excel (.xlsx, .xls) / CSV, or null. The file NAME's extension wins (it is the format the user downloaded), then the
// MIME type. A generic/zip/octet-stream type with the right extension still counts (XLSX.writeFile uses octet-stream).
export function fileKind(blob, name) {
  const ext = extOf(name);
  const t = String(blob?.type || "").toLowerCase();
  const generic = !t || /octet-stream|zip|x-download|force-download/.test(t);
  if (FILE_TYPES[ext] && (generic || t === FILE_TYPES[ext].mime || (ext === "csv" && /csv|text|excel/.test(t)) || (ext === "xls" && /excel/.test(t)))) return ext;
  if (t === FILE_TYPES.pdf.mime) return "pdf";
  if (t === FILE_TYPES.xlsx.mime) return "xlsx";
  if (t === FILE_TYPES.xls.mime) return "xls";
  if (/^text\/csv/.test(t)) return "csv";
  return null;
}
function nameWithExt(n, kind) {
  let s = String(n || "").replace(/[\r\n"\\/<>:|?*\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) s = "document";
  return extOf(s) === kind ? s : `${s.replace(/\.(pdf|xlsx|xls|csv)$/i, "")}.${kind}`;
}

// The exact file just generated: keep it and show the share panel.
//   download — also save it (when the caller has not already); origin — "download" | "share" | "print" (panel wording only).
export function offerFile(blob, filename, { download = false, origin = "download" } = {}) {
  if (!blob) return false;
  const kind = fileKind(blob, filename) || (blob.type ? null : "pdf");
  if (!kind) return false;
  const name = nameWithExt(filename, kind);
  const file = new File([blob], name, { type: FILE_TYPES[kind].mime, lastModified: Date.now() });
  if (download) saveFile(file, name);
  setState({ status: "ready", file, kind, filename: name, size: file.size, at: new Date(), error: "", origin, note: "" });
  return true;
}
// Back-compat name used by the first (PDF-only) version.
export const deliverPdf = (blob, filename, { download = true } = {}) => offerFile(blob, filename, { download });

export function saveFile(blob, name) {
  const url = (origCreate || URL.createObjectURL).call(URL, blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener"; a.dataset.fileshareInternal = "1";
  document.body.appendChild(a);
  (origClick || HTMLAnchorElement.prototype.click).call(a);
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Opens the native share sheet with the kept file. Returns "shared" | "cancelled" | "unsupported" | "blocked" | "error".
export function canShareFile(file) {
  if (!file || typeof navigator === "undefined" || typeof navigator.canShare !== "function" || typeof navigator.share !== "function") return false;
  try { return navigator.canShare({ files: [file] }); } catch { return false; }
}
export async function shareKeptFile() {
  const f = state.file;
  if (!canShareFile(f)) return "unsupported";
  try {
    await navigator.share({ files: [f], title: f.name });
    return "shared";
  } catch (e) {
    if (e?.name === "AbortError") return "cancelled";
    if (e?.name === "NotAllowedError") return "blocked";      // needs a fresh tap (user activation expired while generating)
    return "error";
  }
}

// "Share" buttons: build the file (same generator as the export/print), offer it WITHOUT downloading, and open the native
// share sheet straight away when the browser still allows it; otherwise the panel's Share button does it on the next tap.
// generator() → { blob, filename } (throw Error(message) on failure).
export async function shareGenerated(generator, { label = "file" } = {}) {
  setState({ status: "loading", file: null, kind: null, filename: "", size: 0, error: "", origin: "share", note: `Preparing ${label} to share…` });
  let out;
  try { out = await generator(); } catch (e) { setState({ status: "error", error: e?.message || `Could not prepare the ${label}.` }); return; }
  if (!out?.blob || !out.blob.size) { setState({ status: "error", error: `The ${label} came back empty.` }); return; }
  if (!offerFile(out.blob, out.filename, { origin: "share" })) { setState({ status: "error", error: "This file type cannot be shared." }); return; }
  if (typeof navigator !== "undefined" && navigator.userActivation?.isActive && canShareFile(state.file)) {
    const r = await shareKeptFile();
    if (r === "shared") setShareNote("Share sheet completed.");
    else if (r === "cancelled") setShareNote("Sharing cancelled.");
  }
}

// Fetch helper for generators: a Response → { blob, filename } using the server's file name.
export async function responseToFile(res, fallbackName) {
  if (!res.ok) {
    let msg = `Could not generate the file (error ${res.status}).`;
    try { if (/json/.test(res.headers.get("content-type") || "")) msg = (await res.json()).message || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  return { blob: await res.blob(), filename: filenameFrom(res, fallbackName) };
}

// A same-origin export endpoint that delivers a file (PDF / Excel / CSV).
function isExportUrl(u, a) {
  if (u.origin !== window.location.origin) return false;
  const p = u.pathname;
  if (!p.startsWith("/api/")) return false;
  if (/^\/api\/(file-share|pdf-share|media|uploads|auth)\b/.test(p)) return false;
  const fmt = (u.searchParams.get("format") || "").toLowerCase();
  return ["pdf", "xlsx", "xls", "csv", "excel"].includes(fmt)
    || /\/(pdf|xlsx|xls|csv|excel)(\/|$)/i.test(p) || /\.(pdf|xlsx|xls|csv)$/i.test(p)
    || /\/export(\/|$)|\/export-|\/template(\/|$)/i.test(p) || p.startsWith("/api/supervisor/export/")
    || !!a?.hasAttribute("download");
}

function filenameFrom(res, url) {
  const cd = res.headers.get("content-disposition") || "";
  const star = cd.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")); } catch { /* fall through */ } }
  const plain = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (plain) return plain[1].trim();
  try { return decodeURIComponent(new URL(url, window.location.href).pathname.split("/").filter(Boolean).pop() || "document"); } catch { return url || "document"; }
}

async function fetchAndDeliver(href) {
  setState({ status: "loading", file: null, kind: null, filename: "", size: 0, error: "", origin: "download", note: "Preparing download…" });
  try {
    const res = await fetch(href, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) {
      let msg = `The file could not be generated (error ${res.status}).`;
      try { if (/json/.test(res.headers.get("content-type") || "")) msg = (await res.json()).message || msg; } catch { /* keep */ }
      setState({ status: "error", error: msg });
      return;
    }
    const blob = await res.blob();
    const name = filenameFrom(res, href);
    if (!blob.size) { setState({ status: "error", error: "The file came back empty. Adjust the selection and try again." }); return; }
    if (!fileKind(blob, name)) { saveFile(blob, name); clearShare(); return; }   // not shareable: saved as before
    offerFile(blob, name, { download: true });
  } catch {
    setState({ status: "error", error: "The file could not be downloaded — network error. Please try again." });
  }
}

export function installFileShareHooks() {
  if (typeof window === "undefined" || window.__fileShareInstalled) return;
  window.__fileShareInstalled = true;
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
  // Released blob URLs are forgotten too (shortly after, so a same-tick download still resolves).
  URL.revokeObjectURL = function (url) { setTimeout(() => blobsByUrl.delete(url), 5000); return origRevoke.call(URL, url); };

  // An anchor that downloads a PDF/Excel/CSV blob: let the download happen, then keep that same file for sharing.
  const offerFromAnchor = (a) => {
    if (!a || a.dataset?.fileshareInternal || a.dataset?.noFileShare || a.dataset?.noPdfShare) return;
    const href = a.getAttribute("href") || "";
    if (!a.hasAttribute("download") || !href.startsWith("blob:")) return;
    const blob = blobsByUrl.get(href);
    if (blob && fileKind(blob, a.getAttribute("download") || "")) offerFile(blob, a.getAttribute("download") || "", { origin: "download" });
  };
  origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (...args) {
    const r = origClick.apply(this, args);
    try { offerFromAnchor(this); } catch { /* never break a download */ }
    return r;
  };

  // Print that opens a generated PDF (window.open(blob:)) — keep that PDF for sharing too.
  const origOpen = window.open;
  window.open = function (url, ...rest) {
    const w = origOpen.call(window, url, ...rest);
    try {
      const blob = typeof url === "string" && url.startsWith("blob:") ? blobsByUrl.get(url) : null;
      if (blob && fileKind(blob, "") === "pdf") offerFile(blob, "print.pdf", { origin: "print" });
    } catch { /* never break printing */ }
    return w;
  };

  // A user's own click on an export link (or on a blob download link).
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target?.closest?.("a[href]");
    if (!a || a.dataset.fileshareInternal || a.dataset.noFileShare || a.dataset.noPdfShare) return;
    const href = a.getAttribute("href") || "";
    if (href.startsWith("blob:")) { if (e.isTrusted) setTimeout(() => offerFromAnchor(a), 0); return; }
    let u; try { u = new URL(href, window.location.href); } catch { return; }
    if (!isExportUrl(u, a)) return;
    e.preventDefault();
    fetchAndDeliver(u.toString());
  }, true);
}

// ---------------------------------------------------------------------------------------------------------------------------
// HTML print views (window.print of a page region) produce no file. To share what is being printed, the printable region is
// turned into the common PDF payload (/api/pdf/generate): headings → section titles, tables → tables, label/value lists
// (<dl>, or two-part cards) → Field/Value tables, remaining text → paragraphs. Hidden / no-print parts, buttons and form
// controls are left out, exactly like the printout.
export function domToPdfPayload(root, { title = "Report", subtitle = "", orientation = "portrait" } = {}) {
  const sections = [];
  let cur = null;
  // Status dots / bullets (● ○ •) are decoration with no glyph in the PDF fonts — dropped.
  const norm = (t) => String(t ?? "").replace(/[\u25CB\u25CF\u2022\u25E6]/g, "").replace(/\s+/g, " ").trim();
  const isControl = (el) => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
  const controlValue = (el) => {
    if (el.tagName === "SELECT") { const o = el.selectedOptions?.[0]; return o && o.value !== "" ? norm(o.textContent) : ""; }
    if (el.tagName === "INPUT" && /^(checkbox|radio)$/i.test(el.type)) return el.checked ? "Yes" : "";
    if (el.tagName === "INPUT" && /^(hidden|file|button|submit|reset|image|password)$/i.test(el.type)) return "";
    return norm(el.value);
  };
  const skip = (el) => {
    if (!(el instanceof Element)) return true;
    if (/^(BUTTON|SCRIPT|STYLE|SVG|NOSCRIPT|IMG|CANVAS|DATALIST|OPTION)$/i.test(el.tagName)) return true;
    if (el.matches(".no-print, .la-no-print, [aria-hidden='true'], [hidden]")) return true;
    const cs = getComputedStyle(el);
    return cs.display === "none" || cs.visibility === "hidden";
  };
  // The visible text of an element INCLUDING what is typed in its form fields (innerText leaves those out).
  const text = (el) => {
    if (isControl(el)) return controlValue(el);
    let out = "";
    for (const n of el.childNodes) {
      if (n.nodeType === 3) out += ` ${n.textContent}`;
      else if (n.nodeType === 1 && !skip(n)) out += ` ${text(n)}`;
    }
    return norm(out);
  };
  const BLOCK = /^(DIV|SECTION|ARTICLE|P|UL|OL|LI|TABLE|DL|H1|H2|H3|H4|H5|H6|HEADER|FOOTER|MAIN|ASIDE|FORM|FIELDSET|NAV|LABEL)$/;
  const isBlock = (c) => BLOCK.test(c.tagName) || /^(block|flex|grid|list-item|table)$/.test(getComputedStyle(c).display);
  const kids = (el) => [...el.children].filter((c) => !skip(c));
  const hasBlockChild = (el) => kids(el).some(isBlock);
  const section = (t) => { cur = { title: t || undefined, parts: [] }; sections.push(cur); };
  const push = (part) => { if (!cur) section(""); cur.parts.push(part); };
  let titleSeen = false;
  const walk = (el) => {
    if (skip(el)) return;
    const tag = el.tagName;
    if (/^H[1-4]$/.test(tag)) {
      const t = text(el);
      if (!titleSeen && t === norm(title)) { titleSeen = true; return; }     // the PDF already carries the title
      section(t); return;
    }
    if (tag === "TABLE") {
      const rows = [...el.querySelectorAll("tr")].map((tr) => [...tr.children].filter((c) => !skip(c)).map(text));
      const head = rows.shift();
      if (head?.length) push({ columns: head.map((h) => ({ header: h || " " })), rows: rows.filter((r) => r.some(Boolean)) });
      return;
    }
    if (tag === "DL") {
      const rows = [...el.querySelectorAll("dt")].map((dt) => [text(dt), dt.nextElementSibling ? text(dt.nextElementSibling) : ""]);
      if (rows.length) push({ pairs: rows });
      return;
    }
    if (isControl(el)) { const v = controlValue(el); if (v) push({ text: v }); return; }
    const ks = kids(el);
    // A label/value card: exactly two parts, neither with its own blocks (e.g. "Total Voters" / "2,45,000").
    if (ks.length === 2 && ks.every((k) => !hasBlockChild(k))) {
      const [l, v] = ks.map(text);
      if (l && l.length <= 60) { push({ pairs: [[l, v || "—"]] }); return; }
    }
    if (!hasBlockChild(el)) { const t = text(el); if (t) push({ text: t }); return; }
    ks.forEach(walk);
  };
  kids(root).forEach(walk);
  // Per section: consecutive text → one paragraph; consecutive label/value pairs → one Field / Value table.
  const out = [];
  for (const s of sections) {
    let first = true;
    let buf = [];
    let pairs = [];
    const emit = (part) => { out.push({ title: first ? s.title : undefined, ...part }); first = false; };
    const flush = () => {
      if (buf.length) { emit({ text: buf.join("\n") }); buf = []; }
      if (pairs.length) { emit({ columns: [{ header: "Field", flex: 1 }, { header: "Value", flex: 2 }], rows: pairs }); pairs = []; }
    };
    for (const p of s.parts) {
      if (p.text) { if (pairs.length) flush(); if (!buf.includes(p.text)) buf.push(p.text); continue; }
      if (p.pairs) { if (buf.length) flush(); pairs.push(...p.pairs); continue; }
      flush(); emit(p);
    }
    flush();
    if (first && s.title) out.push({ title: s.title, text: " " });
  }
  return { title, subtitle, orientation, sections: out.slice(0, 400) };
}

// Generator for an HTML print region → the common PDF (POST /api/pdf/generate).
export function printRegionPdf(root, opts) {
  return async () => {
    if (!root) throw new Error("Nothing to share yet.");
    const payload = domToPdfPayload(root, opts);
    const filename = `${String(opts?.title || "report").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "report"}.pdf`;
    const res = await fetch("/api/pdf/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, filename }) });
    return responseToFile(res, filename);
  };
}
