import { query } from "@/lib/db";
import { classifyPollingRows, TEMPLATE_HEADERS } from "@/lib/pollingImportCore";

// DB-backed entry point for the Polling Station Master (Voter Master) bulk
// importer. All parse/validate LOGIC lives in the pure, DB-free
// src/lib/pollingImportCore.js (unit-tested with `node --test`); this module only
// fetches the master data that logic needs, so the preview (dry-run) and the
// commit run the EXACT same classification. Nothing here writes.
//
// Master Data is the single source of truth — assemblies are matched, never
// created — so we read every assembly currently in master (la_assemblies mirrored
// from locations of type 'assembly', INNER JOIN like the polling list route) plus
// which ones already carry polling figures (to classify new vs update).

export { TEMPLATE_HEADERS };

export async function parseAndValidatePolling(rows) {
  const masterRows = await query(
    `SELECT a.id AS assembly_id, ml.name AS name, dl.name AS district
       FROM la_assemblies a
       JOIN locations ml ON ml.id = a.location_id AND ml.type = 'assembly'
       LEFT JOIN locations dl ON dl.id = ml.parent_id AND dl.type = 'district'`
  );
  const existingPolling = await query("SELECT assembly_id FROM la_polling_data");
  return classifyPollingRows(rows, {
    masterRows,
    hasPollingIds: existingPolling.map((r) => r.assembly_id),
  });
}
