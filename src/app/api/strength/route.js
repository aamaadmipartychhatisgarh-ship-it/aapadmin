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
  [4000,  ["Gariaband", "Gariyaband"]],
  [2000,  ["Gaurela-Pendra-Marwahi", "Gaurella-Pendra-Marwahi"]],
  [6000,  ["Janjgir-Champa", "Janjgir Champa"]],
  [6000,  ["Jashpur"]],
  [4000,  ["Kabirdham", "Kabeerdham", "Kawardha"]],
  [6000,  ["Kanker", "Uttar Bastar Kanker"]],
  [4000,  ["Khairagarh-Chhuikhadan-Gandai", "Khairagarh Chhuikhadan Gandai"]],
  [2000,  ["Kondagaon"]],
  [8000,  ["Korba"]],
  [4000,  ["Koriya", "Korea", "Koria"]],
  [2000,  ["MCB", "Manendragarh-Chirmiri-Bharatpur", "Manendragarh-Chirmiri-Bharatpur(M C B)", "Manendragarh Chirmiri Bharatpur"]],
  [8000,  ["Mahasamund"]],
  [2000,  ["Mohla-Manpur-Ambagarh Chowki", "Mohla-Manpur-Ambagarh Chouki", "Mohla Manpur Ambagarh Chowki"]],
  [2000,  ["Mungeli"]],
  [4000,  ["Narayanpur"]],
  [2000,  ["Raigarh"]],
  [8000,  ["Raipur"]],
  [8000,  ["Rajnandgaon"]],
  [6000,  ["Sakti"]],
  [8000,  ["Sarangarh-Bilaigarh", "Sarangarh Bilaigarh"]],
  [2000,  ["Sukma"]],
  [6000,  ["Surajpur"]],
  [6000,  ["Surguja"]],
];

// Canonicalize a district name for matching: lowercase, drop any parenthetical
// suffix (e.g. "(M C B)"), then strip everything that isn't a letter/digit so
// spaces, hyphens and punctuation differences never split one district in two.
function normDistrict(s) {
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

// Organization strength score per district, combining the actual workforce
// (real users/callers assigned to the district) and calling performance
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

    const workerRolePlaceholders = WORKER_ROLES.map(() => "?").join(",");
    const rows = await query(
      `SELECT ld.id, ld.name,
              (SELECT COUNT(*) FROM users usr
                 WHERE usr.home_district_id = ld.id
                   AND usr.role IN (${workerRolePlaceholders})) AS worker_count,
              (SELECT COUNT(*) FROM calls c WHERE c.district_id = ld.id) AS call_count,
              (SELECT COUNT(*) FROM calls c JOIN call_statuses cs ON cs.id=c.status_id
                 WHERE c.district_id = ld.id AND cs.name='Phone Picked') AS connected_count
         FROM locations ld
        WHERE ld.type = 'district' ${districtFilter}
        ORDER BY ld.name`,
      [...WORKER_ROLES, ...dParams]
    );

    // Normalize the workforce + calling factors 0-100 across districts, then a
    // weighted composite. Weights (sum 1.0): workforce 45, calling volume 30,
    // connect rate 25 — the Teams/activity weights were removed with those
    // columns and redistributed onto the metrics this table now shows.
    const max = {
      worker: Math.max(1, ...rows.map((r) => r.worker_count)),
      call: Math.max(1, ...rows.map((r) => r.call_count)),
    };
    const scored = rows.map((r) => {
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
    }).sort((a, b) => b.score - a.score);

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
