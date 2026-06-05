// Build-time prep for the Tauri desktop bundle (Path A — sidecar).
//
// Runs as tauri.conf.json `beforeBuildCommand`. It:
//   1. Builds Next.js in standalone mode (.next/standalone/server.js)
//   2. Assembles src-tauri/server/  = standalone + static + public + .env
//   3. Copies the system node.exe to src-tauri/binaries/node-server-<triple>.exe
//      so Tauri bundles it as the `node-server` sidecar.
//
// After this, `tauri build` compiles the Rust shell and packages everything
// into a single installer .exe.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAURI = path.join(ROOT, "src-tauri");
const SERVER_OUT = path.join(TAURI, "server");
const BIN_OUT = path.join(TAURI, "binaries");

function log(m) { console.log(`[prepare-sidecar] ${m}`); }

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  // Built-in recursive copy handles symlinks and special cache files robustly.
  fs.cpSync(src, dest, { recursive: true, force: true });
}

// --- 1. Next.js standalone build --------------------------------------------
// Set SKIP_NEXT_BUILD=1 to reuse an existing .next/standalone (faster iteration).
const standalone = path.join(ROOT, ".next", "standalone");
if (process.env.SKIP_NEXT_BUILD === "1" && fs.existsSync(path.join(standalone, "server.js"))) {
  log("Reusing existing standalone build (SKIP_NEXT_BUILD=1).");
} else {
  log("Building Next.js (standalone)…");
  execSync("npx next build", { cwd: ROOT, stdio: "inherit" });
}
if (!fs.existsSync(path.join(standalone, "server.js"))) {
  throw new Error("standalone build missing — is `output: 'standalone'` set in next.config.mjs?");
}

// --- 2. Assemble src-tauri/server/ ------------------------------------------
log("Assembling server resource folder…");
rmrf(SERVER_OUT);
fs.mkdirSync(SERVER_OUT, { recursive: true });

// standalone already contains server.js + a trimmed node_modules + .next (server)
copyDir(standalone, SERVER_OUT);
// static assets and public are NOT included in standalone — add them.
copyDir(path.join(ROOT, ".next", "static"), path.join(SERVER_OUT, ".next", "static"));
copyDir(path.join(ROOT, "public"), path.join(SERVER_OUT, "public"));

// Ship the production env (DB creds etc.) next to the server.
// NOTE: these credentials are extractable from the installed app.
const envSrc = fs.existsSync(path.join(ROOT, ".env.production"))
  ? path.join(ROOT, ".env.production")
  : path.join(ROOT, ".env.local");
if (fs.existsSync(envSrc)) {
  fs.copyFileSync(envSrc, path.join(SERVER_OUT, ".env"));
  log(`Bundled env from ${path.basename(envSrc)}`);
}

// --- 3. node-server sidecar binary ------------------------------------------
log("Preparing node sidecar binary…");
fs.mkdirSync(BIN_OUT, { recursive: true });

// Tauri externalBin expects <name>-<rust-target-triple><ext>.
// Resolve the host triple via rustc; fall back to the common Windows MSVC triple.
let triple = "x86_64-pc-windows-msvc";
try {
  const out = execSync("rustc -vV", { encoding: "utf8" });
  const m = out.match(/host:\s*(\S+)/);
  if (m) triple = m[1];
} catch {
  log("rustc not found — assuming x86_64-pc-windows-msvc target triple.");
}

const ext = process.platform === "win32" ? ".exe" : "";
const nodePath = process.execPath; // the node.exe currently running this script
const sidecarName = `node-server-${triple}${ext}`;
const sidecarPath = path.join(BIN_OUT, sidecarName);
fs.copyFileSync(nodePath, sidecarPath);
log(`Sidecar binary: binaries/${sidecarName}`);

log("Done. Ready for `tauri build`.");
