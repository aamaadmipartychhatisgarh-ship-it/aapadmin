import { query } from "@/lib/db";
import { TIME_PRESETS } from "./timeRanges";

const GEO_LABELS = {
  zone_id: "Zone", lok_sabha_id: "Lok Sabha", district_id: "District",
  assembly_id: "Assembly", ward_id: "Block", booth_id: "Booth",
};

// Turns the request body + resolved module meta into a short list of
// human-readable "Label: value, value" lines for the print/export header —
// so a printed report is self-explanatory about what it actually shows.
export async function describeFilters({ module, meta, body }) {
  const lines = [];

  const preset = TIME_PRESETS.find((p) => p.key === body.time);
  if (body.time === "custom" && (body.date_from || body.date_to)) {
    lines.push(`Time: ${body.date_from || "…"} to ${body.date_to || "…"}`);
  } else if (preset && preset.key !== "all") {
    lines.push(`Time: ${preset.label}`);
  }

  if (module.geo && body.geo) {
    for (const [key, label] of Object.entries(GEO_LABELS)) {
      const raw = body.geo[key];
      const ids = (Array.isArray(raw) ? raw : String(raw ?? "").split(",")).map((v) => String(v).trim()).filter(Boolean);
      if (!ids.length) continue;
      const rows = await query(`SELECT name FROM locations WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
      lines.push(`${label}: ${rows.map((r) => r.name).join(", ")}`);
    }
  }

  const fvals = body.filters || {};
  for (const f of meta.filters || []) {
    const raw = fvals[f.key];
    const ids = (Array.isArray(raw) ? raw : String(raw ?? "").split(",")).map((v) => String(v).trim()).filter(Boolean);
    if (!ids.length) continue;
    if (f.type === "bool") {
      lines.push(`${f.label}: ${ids[0] === "1" ? "Yes" : "No"}`);
    } else {
      const byValue = new Map((f.options || []).map((o) => [String(o.value), o.label]));
      lines.push(`${f.label}: ${ids.map((v) => byValue.get(v) || v).join(", ")}`);
    }
  }

  if ((body.search || "").trim()) lines.push(`Search: "${body.search.trim()}"`);

  return lines;
}
