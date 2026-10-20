import { query } from "@/lib/db";
import { VEHICLES, _VEHICLE_SET, vehicleLabel } from "@/lib/vehicleOptions";
export { VEHICLES, vehicleLabel };

// Contact Vehicle — one additive column on `contacts`:
//   vehicle  'two_wheeler' | 'four_wheeler'   (NULL = no vehicle recorded)
let _ensured = false;
// Adds the column once (idempotent, race-safe). Call before reading the contacts column
// set so the field is included.
export async function ensureVehicleColumn() {
  if (_ensured) return true;
  try {
    const have = (await query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts' AND COLUMN_NAME = 'vehicle'`
    ))[0]?.n > 0;
    if (!have) {
      try { await query("ALTER TABLE contacts ADD COLUMN vehicle VARCHAR(20) NULL"); }
      catch (e) { if (!/duplicate column/i.test(e?.message || "")) throw e; }
    }
    _ensured = true;
  } catch (e) {
    console.error("[contacts] ensureVehicleColumn:", e?.message || e);
  }
  return _ensured;
}

// Validate + normalise the vehicle part of a request body.
//   → { present:false }                 body says nothing about it (leave as is)
//   → { present:true, vehicle }         value to store (null clears it)
//   → { error }                         invalid input (HTTP 400)
export function normalizeVehicle(data) {
  if (!data || !("vehicle" in data)) return { present: false };
  const v = String(data.vehicle ?? "").trim().toLowerCase();
  if (!v) return { present: true, vehicle: null };
  if (!_VEHICLE_SET.has(v)) return { error: "Vehicle must be Two Wheeler or Four Wheeler." };
  return { present: true, vehicle: v };
}
