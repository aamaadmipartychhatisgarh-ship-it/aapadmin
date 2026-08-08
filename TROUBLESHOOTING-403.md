# Fixing the dashboard "403 Forbidden — Access to this resource on the server is denied!"

## TL;DR — where the 403 comes from

The 403 is **not** produced by this Next.js application. It is produced by
**Hostinger's LiteSpeed web server** in front of the Node app. The fix is a
Hostinger/LiteSpeed configuration change, not a code change.

### How we know (evidence, not assumption)

Tested against the real production build (`next build` + `next start`), logging
in as both roles and requesting every dashboard route with the session cookie:

| Route | Super Admin | Supervisor |
|---|---|---|
| `/dashboard` | 200 | 200 |
| `/dashboard/admin` | 200 | — |
| `/dashboard/supervisor` | — | 200 |
| `/dashboard/analytics` | 200 | — |
| `/dashboard/admin/contacts` / `/dashboard/supervisor/contacts` | 200 | 200 |
| `/dashboard/tasks` | 200 | 200 |
| `/dashboard/admin/administration` | 200 | — |
| `/dashboard/reports` | 200 | 200 |
| `/dashboard/leader-assessment` | 200 | 200 |

Also confirmed:

- There is **no `middleware.ts/js`** and **no `.htaccess`** in the repository,
  and no custom server — so nothing in the app can emit a server 403 for a page.
- The dashboard document route returns **200 even when unauthenticated** (the
  auth gate is client-side: the page renders a loader, then `router.push` to
  `/login`). So the app never returns 403 for the dashboard HTML.
- API routes return **JSON** `401`/`403` (`{"message":"..."}`), never an HTML page.
- The exact string **"Access to this resource on the server is denied!"** does
  not exist anywhere in the app source or the built output — it is the verbatim
  **LiteSpeed default 403 body**.
- `next.config.mjs` sets no `basePath`, `assetPrefix`, or `trailingSlash`, so
  there is no routing/rewrite mismatch. NextAuth uses the standard JWT strategy
  with default cookies; sessions carry the correct `role` for both roles.

Because there is no LiteSpeed layer locally, the 403 **cannot be reproduced in
the sandbox** — which is itself confirmation that the app is not the source.

## Diagnose first (do this before changing anything)

Open **hPanel → your live Node app** and read the logs — the log names the cause:

1. **LiteSpeed / server error log** (hPanel → *Advanced → Error logs*, or the
   file under `logs/`). Look for the 403 entries at the time of a failed
   dashboard load. The reason will be one of:
   - `ModSecurity: Access denied … [id "……"]` → **cause A** (WAF false positive).
   - `Permission denied` / `access to … denied` on a file/dir → **cause B**.
   - `Connection refused` / `502/503` proxying to the Node app → **cause C**.
2. **Node app log** (hPanel → the Node app → *Logs*): confirm the app is
   **running** and not crash-looping at those timestamps.

Record the exact ModSecurity rule **id** if present — the fix targets that id.

## The fix — by cause

### Cause A (most common): LiteSpeed ModSecurity / WAF false positive
The WAF flags a legitimate request after login (often the NextAuth cookie or a
POST). **Do not disable the whole WAF** (that weakens security). Whitelist only
the offending rule id you found in the log:

- **hPanel way:** hPanel → *Security → Web Application Firewall / ModSecurity* →
  disable/whitelist that specific rule id for this domain.
- **`.htaccess` way** (only after you have the id — place in the app's
  `public_html`/document root):
  ```apache
  <IfModule LiteSpeed>
    SecRuleRemoveById 9999999   # <- replace with the id from the error log
  </IfModule>
  ```
  This removes one over-eager rule; every other WAF protection stays on.

### Cause B: file/directory permissions after a deploy
LiteSpeed returns 403 when it can't read a file/enter a directory. Reset to the
standard, safe values in the app directory:
```bash
find . -type d -not -path './node_modules/*' -exec chmod 755 {} \;
find . -type f -not -path './node_modules/*' -exec chmod 644 {} \;
```
(Directories must be `755`, files `644`, owned by your hosting user.)

### Cause C: Node app down / proxy not catching all paths
If the Node process is stopped or restarting, LiteSpeed can't proxy and falls
back to the filesystem; `/dashboard` isn't a real file, so with `Options
-Indexes` it answers **403**. Fix:
- hPanel → the Node.js app → **Restart**, and set it to auto-start.
- Confirm the app's **Application URL/root** and **Start command** (`npm start`)
  are correct so *all* paths proxy to Node.

### Also do: purge the CDN
Hostinger's CDN does not auto-purge and can keep serving a transient 403 from one
edge node ("sometimes"). After applying the fix: **hPanel → CDN → Purge cache**
(or disable the CDN briefly to confirm the 403 disappears — a quick way to prove
the CDN was serving a cached error).

## Verify (the real success condition)

After the change, from a fresh browser session on the **live** site:
1. Super Admin login → dashboard opens (HTTP 200), navigate Dashboard →
   Analytics → Contacts → Tasks → Administration → Reports → Leader Assessment.
2. Supervisor login → dashboard opens (HTTP 200), navigate Dashboard → Contacts
   → Tasks → Reports → Leader Assessment.
3. Refresh, open a dashboard URL **directly**, log out/in, open in a new tab,
   browser back/forward — no intermittent 403.
4. `curl -I https://<live-domain>/dashboard` with a valid session cookie →
   `HTTP/2 200`.

Role restrictions are unchanged — this fix touches only the web-server layer, not
the app's authentication or permissions.
