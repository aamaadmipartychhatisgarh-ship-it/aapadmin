# Setup Guide — AAP Admin (Aam Aadmi Party, Chhattisgarh)

A Next.js 16 (App Router) web app: role-based organization management dashboard
backed by MySQL, with NextAuth (credentials) auth.

> NOTE: Next.js here may differ from older versions you know — read
> `node_modules/next/dist/docs/` before non-trivial changes. In Next 16,
> route `params` are Promises (`const { id } = await params`).

---

## 1. Prerequisites

- Node.js 20+
- A MySQL 8 database (local for dev, Hostinger remote for prod)

## 2. Install

```bash
npm install
```

## 3. Environment variables

Create `.env.local` for local development:

```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=aapadmin
DB_PORT=3306
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<run: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
```

For production (Hostinger), set these in the hosting panel's
Environment Variables (NOT in the repo):

```
DB_HOST=localhost            # or 193.203.184.146 if localhost fails
DB_USER=u321483967_aap
DB_PASSWORD=<the DB password>
DB_NAME=u321483967_aap
DB_PORT=3306
NEXTAUTH_URL=https://<your-domain>
NEXTAUTH_SECRET=<a strong unique secret>
NODE_ENV=production
```

## 4. Database setup (order matters)

The schema was built incrementally via migration scripts in `scripts/`.
For a brand-new database, run them in this order:

```bash
node scripts/init-db.mjs                    # base: users, locations, call_statuses, calls, contacts
node scripts/add-roles-hierarchy.mjs        # role + scope columns on users
node scripts/add-contacts-schema.mjs        # extra contact fields
node scripts/add-supervisor-schema.mjs      # monitoring/attendance tables
node scripts/add-org-modules-schema.mjs     # teams, workers, tasks, complaints, badges, rankings, training
node scripts/add-media-schema.mjs           # newspapers, channels, debates, press conferences, journalists
node scripts/add-social-management-schema.mjs  # social pages, posts, analytics
node scripts/add-designations.mjs           # designation master data
```

Then seed geography + users:

```bash
node scripts/seed-chhattisgarh.mjs          # zones / lok sabha / districts / assemblies
node scripts/wipe-and-seed-users.mjs        # creates 8 users (one per role); password = username
node scripts/assign-test-user-scopes.mjs    # gives scoped users a territory (optional, for testing)
```

> All scripts read DB connection from `.env.local`. To target the remote DB,
> use `scripts/load-remote.mjs` (loads a schema + seed dump), or temporarily
> point `.env.local` at the remote host.

## 5. Run

```bash
npm run dev      # http://localhost:3000
npm run build    # production build
npm start        # serve the production build
```

Login with any seeded user, e.g. `superadmin` / `superadmin`.

## 6. Deployment (Hostinger, Git auto-deploy)

The repo is connected to Hostinger's Node.js app, which auto-deploys on push to
`master`:
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Env vars: set in the Hostinger panel (see section 3)

Push to `master` → Hostinger rebuilds and serves the new version.

---

## Roles (highest → lowest authority)

`super_admin > state_admin > zone_admin > district_admin > assembly_admin`,
plus `supervisor` (oversight), `caller` (logs calls), `worker` (field member).

Defined in `src/lib/permissions.js`. Geographic scoping is applied with
`scopeFilterSync(user, alias, { cols })` — it limits what data a scoped admin
sees, resolving territory through the location hierarchy.
