// Worker profile completion → status. A worker is "Active" only when every
// mandatory field is filled; otherwise the status is "Pending". This is the
// single source of truth used by the API (create/edit), the contact↔worker sync,
// the bulk importers and the recompute migration, so every path agrees and no
// worker with a missing mandatory field can ever show as Active.
//
// Mandatory fields (matches the product spec's pseudo-logic — Name && Mobile &&
// Designation && Zone && LokSabha && District && Assembly && Block && Address).
// Profile photo is intentionally NOT required.
export const REQUIRED_WORKER_FIELDS = [
  "name",         // Name
  "mobile",       // Mobile Number
  "position",     // Designation
  "address",      // Address
  "zone_id",      // Zone (Sambhag)
  "lok_sabha_id", // Lok Sabha
  "district_id",  // District
  "assembly_id",  // Assembly
  "ward_id",      // Block / Ward
];

// A value counts as "filled" when it's a non-empty, meaningful value. Location
// ids are integers where 0 / null / "" all mean "not set".
const isFilled = (v) => {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  return s !== "" && s !== "0";
};

// Compute "active" | "pending" from a worker-shaped object.
export function computeWorkerStatus(w) {
  if (!w) return "pending";
  return REQUIRED_WORKER_FIELDS.every((f) => isFilled(w[f])) ? "active" : "pending";
}

// The mandatory fields still missing — used to tell the editor what to complete.
export function missingWorkerFields(w) {
  return REQUIRED_WORKER_FIELDS.filter((f) => !isFilled(w?.[f]));
}

// Recompute + persist a worker's status inside an open transaction. Call this
// after any write that changes a worker's mandatory fields.
export async function recomputeWorkerStatus(conn, workerId) {
  const [rows] = await conn.query("SELECT * FROM workers WHERE id = ?", [workerId]);
  const w = rows[0];
  if (!w) return null;
  const status = computeWorkerStatus(w);
  if (w.status !== status) {
    await conn.query("UPDATE workers SET status = ? WHERE id = ?", [status, workerId]);
  }
  return status;
}
