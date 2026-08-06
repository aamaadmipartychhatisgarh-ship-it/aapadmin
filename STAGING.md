# Staging / Preview environment

Right now every push to `master` auto-deploys straight to the **live** site, so
bugs are only ever found in production. A staging site is a second copy of the
app, on its own URL, that you test **before** promoting a change to `master`.

The app code needs no changes — staging is a hosting + branch + database setup.
This doc gives you two ways to do it. **Option A (a second Hostinger app) is the
recommended one** because it runs exactly like production.

---

## The branch workflow (both options use this)

- `staging` branch  → deploys to the **staging** site (safe to break)
- `master` branch   → deploys to the **live** site (only tested changes)

New flow for every change:

1. Work lands on `staging` → the staging site rebuilds → **you test it there**.
2. Once it looks right, promote it: fast-forward `master` to `staging`
   (`git checkout master && git merge --ff-only staging && git push origin master`)
   → the live site rebuilds.

A `staging` branch already exists in the repo (created alongside this doc).

---

## The database decision (read this first)

Staging must **not** write to your live database, or a test could corrupt real
data (e.g. reassigning 10k contacts). Use a **separate staging database**:

1. Hostinger → **Databases** → create a new MySQL DB, e.g. `u321483967_aap_stg`.
2. Seed it. Two choices:
   - **Copy of production** (most realistic): phpMyAdmin → open the live DB →
     **Export** (Quick, SQL) → open the staging DB → **Import** that file.
   - **Fresh + small sample**: point `.env.local` at the staging DB and run the
     migration scripts in `SETUP.md` §4, then import a small CSV of contacts.
3. The staging app points `DB_NAME` at this staging DB (see below). Everything
   else (DB_HOST/user/pass) can be the same Hostinger MySQL account.

> Whenever you want staging to mirror current production data again, just re-run
> the phpMyAdmin export→import.

---

## Option A — a second Hostinger Node app (recommended)

Hostinger lets you run more than one Node app. Create a second one that tracks
`staging`:

1. **hPanel → Websites → Create / Add website** (or a subdomain such as
   `staging.your-domain.com`, or use the free temporary domain Hostinger offers).
2. **Node.js app** settings, same as the live app:
   - Repository: the same GitHub repo
   - **Branch: `staging`** (this is the only real difference from production)
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
3. **Environment variables** (hPanel → the staging app → Environment):
   ```
   DB_HOST=localhost            # or 193.203.184.146 if localhost fails
   DB_USER=<your db user>
   DB_PASSWORD=<your db password>
   DB_NAME=u321483967_aap_stg   # <-- the STAGING database, not production
   DB_PORT=3306
   NEXTAUTH_URL=https://staging.your-domain.com   # the staging URL
   NEXTAUTH_SECRET=<a different strong secret>
   NODE_ENV=production
   ```
   Generate the secret with:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
4. Deploy. From now on, pushing to `staging` rebuilds this site only.

Pros: identical runtime to production (same `next start`, same MySQL, persistent
connection pool). Cons: uses a bit more of your Hostinger resources.

---

## Option B — Vercel (instant preview per branch/PR)

Vercel gives every branch and pull request its own preview URL automatically,
with zero server management.

1. Sign in to vercel.com with GitHub, **Import** this repo.
2. Add the same environment variables as above (Vercel → Project → Settings →
   Environment Variables), with `DB_NAME` = the staging DB and
   `NEXTAUTH_URL` = the Vercel URL.
3. Every push to any branch (and every PR) gets its own `https://…vercel.app`
   preview link. Merges to `master` can still be left to Hostinger for prod.

Caveats for this app on Vercel:
- Vercel is serverless, so the MySQL must be reachable from the internet — use
  `DB_HOST=193.203.184.146` and add Vercel's egress to Hostinger's **Remote
  MySQL** allow-list (or allow `%`). If Hostinger only allows local DB access,
  Option A is the way to go.
- Each serverless invocation opens its own connection; fine for a staging site's
  low traffic.

---

## What I (Claude) will do differently

Once staging exists, tell me and I'll push new work to **`staging`** instead of
`master`, so you always get to preview and approve before it goes live. I'll
only fast-forward `master` (production) once you say it looks good.
