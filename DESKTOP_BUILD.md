# Building the AAP Admin Desktop App (.exe)

This packages the Next.js app + its server + a remote-MySQL connection into a
single Windows installer using **Tauri** (Path A — the app ships a bundled
Next.js server that runs locally and talks to your Hostinger MySQL).

## Architecture

```
AAP Admin.exe  (Tauri / Rust shell)
   └── on launch → spawns bundled Node + Next.js standalone server  (127.0.0.1:3000)
                      └── connects to remote MySQL  (configured via .env.production)
   └── webview window → loads http://127.0.0.1:3000
```

Everything (API routes, NextAuth login, file uploads) runs inside the bundled
server, exactly like `npm run start`. Verified working against the remote DB.

---

## One-time prerequisites (must install — not present yet)

1. **Rust** — https://rustup.rs → run `rustup-init.exe`, accept defaults (MSVC).
2. **Visual Studio C++ Build Tools** — https://visualstudio.microsoft.com/visual-cpp-build-tools/
   → install the **"Desktop development with C++"** workload. (Tauri needs the
   MSVC linker; rustup will also prompt for this.)
3. WebView2 runtime — already installed on this machine (most Win10/11 have it).

After installing, **open a fresh terminal** and confirm:
```
cargo --version
rustc --version
```

---

## Build the installer

From the project root (`C:\aap admin`):

```bash
npm run tauri:build
```

This automatically:
1. Runs `scripts/prepare-tauri-sidecar.mjs` (the `beforeBuildCommand`), which:
   - builds Next.js in standalone mode,
   - assembles `src-tauri/server/` (server.js + static + public + `.env`),
   - copies `node.exe` to `src-tauri/binaries/node-server-<triple>.exe`.
2. Compiles the Rust shell.
3. Produces the installer at:
   ```
   src-tauri/target/release/bundle/nsis/AAP Admin_0.1.0_x64-setup.exe
   ```

Install that `.exe` and launch "AAP Admin" — it shows a loading splash, the
bundled server boots, then the dashboard appears.

---

## Run in dev (live reload, no compile needed beyond first Rust build)

```bash
npm run tauri:dev
```
This starts `npm run dev` and opens the Tauri window pointing at it. (Still
requires Rust installed for the first compile.)

---

## Configuration / files

| File | Purpose |
|---|---|
| `next.config.mjs` | `output: "standalone"` — required for the sidecar |
| `.env.production` | DB creds + `NEXTAUTH_URL` bundled into the app |
| `src-tauri/tauri.conf.json` | Tauri config — sidecar binary, window, bundle targets |
| `src-tauri/src/lib.rs` | Rust: spawns the server sidecar, waits, opens the window |
| `src-tauri/capabilities/default.json` | Permission to spawn the sidecar |
| `scripts/prepare-tauri-sidecar.mjs` | Assembles the bundle before compile |
| `src-tauri/frontend-shell/index.html` | Loading splash shown before server is ready |

---

## ⚠️ Security note

The DB credentials in `.env.production` are **bundled into the installed app and
are extractable** by anyone who has the `.exe`. This is acceptable only for
internal, trusted machines. Also:

- **Whitelist the connecting IP** in Hostinger hPanel → "Remote MySQL", or the
  remote DB will refuse connections from users' machines.
- For a hardened deployment, host the Next.js app on a server and make the
  desktop app a thin shell pointing at it (Path B) so credentials never ship.

---

## Updating the remote database schema

The remote DB was provisioned by dumping the local schema. To re-sync after
schema changes, re-run the relevant migration scripts in `scripts/` against the
remote DB (they read `.env.local`, currently pointed at the remote host), e.g.:

```bash
node scripts/add-<whatever>-schema.mjs
```
