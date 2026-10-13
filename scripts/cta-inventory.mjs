#!/usr/bin/env node
// Static CTA discovery for docs/CTA_REGISTRY.md — read-only, no DB, no build.
//
//   node scripts/cta-inventory.mjs            # per-file summary table (markdown)
//   node scripts/cta-inventory.mjs --json     # full machine-readable list
//   node scripts/cta-inventory.mjs --since <git-ref>   # only files changed since ref
//
// Counts actionable elements per source file (buttons, links, form submits,
// programmatic navigation, downloads/uploads) and maps page files to their route.
// It is a discovery aid, not evidence: a counted CTA is NOT a tested CTA.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { execSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const sinceIdx = args.indexOf("--since");
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : null;

const PATTERNS = {
  button: /<(button|Button)\b/g,
  link: /<(Link\b|a\s[^>]*href=)/g,
  submit: /onSubmit=|type="submit"/g,
  navigate: /router\.(push|replace)\(|window\.location(\.href)?\s*=/g,
  download: /\bdownload\b=|\.xlsx|\/export\b|window\.print\(/g,
  upload: /type="file"/g,
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name) && !p.includes(`${sep}api${sep}`)) out.push(p);
  }
  return out;
}

// src/app/dashboard/admin/users/page.js → /dashboard/admin/users
function routeOf(rel) {
  if (!rel.startsWith(`src${sep}app${sep}`) || !/page\.(jsx?|tsx?)$/.test(rel)) return null;
  const r = rel.slice(`src${sep}app`.length).replace(/[\\/]page\.(jsx?|tsx?)$/, "").split(sep).join("/");
  return r || "/";
}

let files = walk(SRC);
if (since) {
  const changed = new Set(
    execSync(`git diff --name-only ${since} -- src`, { cwd: ROOT }).toString().trim().split("\n").filter(Boolean)
  );
  files = files.filter((f) => changed.has(relative(ROOT, f).split(sep).join("/")));
}

const rows = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  const counts = {};
  let total = 0;
  for (const [k, re] of Object.entries(PATTERNS)) {
    counts[k] = (text.match(re) || []).length;
    total += k === "submit" || k === "download" ? 0 : counts[k]; // overlap with button/link
  }
  if (!total && !counts.submit) continue;
  const rel = relative(ROOT, f);
  rows.push({ file: rel.split(sep).join("/"), route: routeOf(rel), total, ...counts });
}
rows.sort((a, b) => (a.route ? 0 : 1) - (b.route ? 0 : 1) || a.file.localeCompare(b.file));

const rev = (() => { try { return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); } catch { return "unknown"; } })();
if (asJson) {
  console.log(JSON.stringify({ revision: rev, since, files: rows }, null, 2));
} else {
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  console.log(`CTA discovery @ ${rev}${since ? ` (changed since ${since})` : ""}: ${rows.length} files, ` +
    `${sum("button")} buttons, ${sum("link")} links, ${sum("submit")} submits, ${sum("navigate")} navigations, ` +
    `${sum("upload")} uploads, ${sum("download")} download/export hints\n`);
  console.log("| File | Route | Btn | Link | Submit | Nav | Upload |\n|---|---|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.file} | ${r.route || "—"} | ${r.button} | ${r.link} | ${r.submit} | ${r.navigate} | ${r.upload} |`);
}
