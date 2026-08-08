import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, normalizeRole, ROLES } from "@/lib/permissions";
import { query } from "@/lib/db";

// Fixed Required-Workers targets for the 33 Chhattisgarh districts. These are
// planning targets (NOT actual counts) and never change here. Each entry lists
// the accepted spellings/aliases so the value binds to the district regardless
// of how the master `locations` row is named (e.g. "Kanker" vs the official
// "Uttar Bastar Kanker", "Dantewada" vs "Dakshin Bastar Dantewada", the MCB
// district's long form, and the Chowki/Chouki spelling variant).
const REQUIRED_WORKERS_TARGETS = [
  [6000,  ["Balod"]],
  [6000,  ["Baloda Bazar", "Balodabazar-Bhatapara", "Baloda Bazar-Bhatapara"]],
  [4000,  ["Balrampur", "Balrampur-Ramanujganj"]],
  [6000,  ["Bastar"]],
  [6000,  ["Bemetara"]],
  [2000,  ["Bijapur"]],
  [12000, ["Bilaspur"]],
  [2000,  ["Dantewada", "Dakshin Bastar Dantewada"]],
  [6000,  ["Dhamtari"]],
  [12000, ["Durg"]],
  [4000,  ["Gariyaband", "Gariaband"]],
  [2000,  ["Gaurela-Pendra-Marwahi", "Gaurella-Pendra-Marwahi"]],
  [6000,  ["Janjgir-Champa", "Janjgir Champa"]],
  [6000,  ["Jashpur"]],
  [4000,  ["Kabirdham", "Kabeerdham", "Kawardha"]],
  [6000,  ["Kanker", "Uttar Bastar Kanker"]],
  [2000,  ["Khairagarh-Chhuikhadan-Gandai", "Khairagarh Chhuikhadan Gandai"]],
  [4000,  ["Kondagaon"]],
  [8000,  ["Korba"]],
  [4000,  ["Koriya", "Korea", "Koria"]],
  [2000,  ["Manendragarh-Chirmiri-Bharatpur", "MCB", "Manendragarh-Chirmiri-Bharatpur(M C B)", "Manendragarh Chirmiri Bharatpur"]],
  [8000,  ["Mahasamund"]],
  [2000,  ["Mohla-Manpur-Ambagarh Chowki", "Mohla-Manpur-Ambagarh Chouki", "Mohla Manpur Ambagarh Chowki"]],
  [4000,  ["Mungeli"]],
  [2000,  ["Narayanpur"]],
  [8000,  ["Raigarh"]],
  [14000, ["Raipur"]],
  [8000,  ["Rajnandgaon"]],
  [6000,  ["Sakti"]],
  [4000,  ["Sarangarh-Bilaigarh", "Sarangarh Bilaigarh"]],
  [2000,  ["Sukma"]],
  [6000,  ["Surajpur"]],
  [6000,  ["Surguja"]],
];

// Canonicalize a district name for matching: lowercase, drop any parenthetical
// suffix (e.g. "(M C B)"), then strip everything that isn't a letter/digit so
// spaces, hyphens and punctuation differences never split one district in two.
// Reused for both the Required-Workers alias table and any future name joins.
export function normDistrict(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

const REQUIRED_BY_NORM = {};
for (const [value, names] of REQUIRED_WORKERS_TARGETS) {
  for (const n of names) REQUIRED_BY_NORM[normDistrict(n)] = value;
}
function requiredWorkersFor(dbName) {
  return REQUIRED_BY_NORM[normDistrict(dbName)] ?? 0;
}

// Raw `users.role` values that count as actual field workers/callers for the
// Workers column — the same people Administration → Users manages. Oversight
// roles (super_admin/state/zone/district/assembly admin, supervisor) and the
// media roles are intentionally excluded; contacts live in a separate table and
// are never counted here.
const WORKER_ROLES = ["caller", "worker", "user", "agent"];

// Resolve every ACTIVE worker/caller user to exactly one district and return a
// Map<district_id, count>. A user's district is taken from the first REAL
// signal that exists, in priority order:
//   1. users.home_district_id      — the district set in Administration → Users
//   2. workers.district_id          — via the workers row linked by workers.user_id
//   3. calls.district_id            — the district where they log the most calls
// This fixes "Workers = 0" when home_district_id was never filled in, without
// inventing any number: every count still comes from a real existing relation.
// Three grouped queries (no per-user fan-out) keep it efficient.
async function workersByDistrict() {
  const rolePlaceholders = WORKER_ROLES.map(() => "?").join(",");
  const users = await query(
    `SELECT id, home_district_id FROM users
      WHERE is_active = 1 AND role IN (${rolePlaceholders})`,
    WORKER_ROLES
  );
  if (users.length === 0) return new Map();

  const ids = users.map((u) => u.id);
  const idPlaceholders = ids.map(() => "?").join(",");

  // workers.user_id → a district (one per user; MIN is arbitrary-but-stable).
  const workerRows = await query(
    `SELECT user_id, MIN(district_id) AS district_id
       FROM workers
      WHERE user_id IN (${idPlaceholders}) AND district_id IS NOT NULL
      GROUP BY user_id`,
    ids
  );
  const workerDistrict = new Map(workerRows.map((r) => [r.user_id, r.district_id]));

  // calls.user_id → the district they called into most often.
  const callRows = await query(
    `SELECT user_id, district_id, COUNT(*) AS n
       FROM calls
      WHERE user_id IN (${idPlaceholders}) AND district_id IS NOT NULL
      GROUP BY user_id, district_id`,
    ids
  );
  const topCallDistrict = new Map();
  const bestN = new Map();
  for (const r of callRows) {
    if (!bestN.has(r.user_id) || r.n > bestN.get(r.user_id)) {
      bestN.set(r.user_id, r.n);
      topCallDistrict.set(r.user_id, r.district_id);
    }
  }

  const counts = new Map();
  for (const u of users) {
    const did = u.home_district_id ?? workerDistrict.get(u.id) ?? topCallDistrict.get(u.id) ?? null;
    if (did == null) continue;
    counts.set(did, (counts.get(did) || 0) + 1);
  }
  return counts;
}

// Organization strength score per district, combining the actual workforce
// (real active users/callers assigned to the district) and calling performance
// (attempt volume + connect rate). Teams and per-worker "activity score" are no
// longer part of this view.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    // Scope which districts the user sees: zone-admin → districts in that zone,
    // district-admin → only their district, assembly-admin → district of their assembly.
    const role = normalizeRole(session.user.role);
    const u = session.user;
    let districtFilter = "";
    const dParams = [];
    if (role === ROLES.ZONE_ADMIN && u.scope_zone_id) {
      // districts whose parent (lok_sabha) parent is the zone
      districtFilter = `AND ld.parent_id IN (SELECT id FROM locations WHERE type='lok_sabha' AND parent_id = ?)`;
      dParams.push(u.scope_zone_id);
    } else if (role === ROLES.DISTRICT_ADMIN && u.home_district_id) {
      districtFilter = `AND ld.id = ?`;
      dParams.push(u.home_district_id);
    } else if (role === ROLES.ASSEMBLY_ADMIN && u.scope_assembly_id) {
      // district that owns this assembly
      districtFilter = `AND ld.id = (SELECT parent_id FROM locations WHERE id = ?)`;
      dParams.push(u.scope_assembly_id);
    }

    const [rows, workerCounts] = await Promise.all([
      query(
        `SELECT ld.id, ld.name,
                (SELECT COUNT(*) FROM calls c WHERE c.district_id = ld.id) AS call_count,
                (SELECT COUNT(*) FROM calls c JOIN call_statuses cs ON cs.id=c.status_id
                   WHERE c.district_id = ld.id AND cs.name='Phone Picked') AS connected_count
           FROM locations ld
          WHERE ld.type = 'district' ${districtFilter}
          ORDER BY ld.name`,
        dParams
      ),
      workersByDistrict(),
    ]);

    // Normalize the workforce + calling factors 0-100 across districts, then a
    // weighted composite. Weights (sum 1.0): workforce 45, calling volume 30,
    // connect rate 25 — the Teams/activity weights were removed with those
    // columns and redistributed onto the metrics this table now shows.
    const withWorkers = rows.map((r) => ({ ...r, worker_count: workerCounts.get(r.id) || 0 }));
    const max = {
      worker: Math.max(1, ...withWorkers.map((r) => r.worker_count)),
      call: Math.max(1, ...withWorkers.map((r) => r.call_count)),
    };
    const scored = withWorkers.map((r) => {
      const workerScore = (r.worker_count / max.worker) * 100;
      const callScore = (r.call_count / max.call) * 100;
      const connectRate = r.call_count > 0 ? (r.connected_count / r.call_count) * 100 : 0;
      const score = Math.round(workerScore * 0.45 + callScore * 0.30 + connectRate * 0.25);
      const band = score >= 60 ? "strong" : score >= 35 ? "medium" : "weak";
      return {
        id: r.id,
        name: r.name,
        score,
        band,
        district: r.name,
        requiredWorkers: requiredWorkersFor(r.name),
        workers: r.worker_count,
        attemptCalls: r.call_count,
        strength: score,
        // Back-compat aliases still read by any older UI build.
        worker_count: r.worker_count,
        call_count: r.call_count,
      };
      // Sort by strength desc, then attempt calls desc as the tie-breaker.
    }).sort((a, b) => b.score - a.score || b.attemptCalls - a.attemptCalls);

    const summary = {
      strong: scored.filter((s) => s.band === "strong").length,
      medium: scored.filter((s) => s.band === "medium").length,
      weak: scored.filter((s) => s.band === "weak").length,
    };

    return NextResponse.json({ areas: scored, summary });
  } catch (err) {
    console.error("strength error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
