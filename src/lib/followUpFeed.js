import { query } from "@/lib/db";
import { ensureInfluencerSchema, getInfluencerColumns } from "@/lib/influencerSchema";
import { ensureContactDesignationsSchema } from "@/lib/contactDesignations";
import { enrichJoinedBy } from "@/lib/influencerIO";
import { todayInAppTz, addDaysYmd } from "@/lib/followUpReminder";

// The Supervisor-2 "Influencer Follow-ups" feed, shared by the dashboard card and
// its Excel export so both show exactly the same records. The supervisor is ALWAYS
// the caller-supplied session user id (never a request parameter), and the SQL
// pins assigned_supervisor_id to it.
export const FOLLOW_UP_RANGES = ["all", "today", "tomorrow", "7", "30"];
const MAX_ROWS = 2000;

export function parseFollowUpFilters(searchParams) {
  const r = String(searchParams.get("range") || "all");
  return { range: FOLLOW_UP_RANGES.includes(r) ? r : "all", search: String(searchParams.get("search") || "").trim().slice(0, 100) };
}

// Upcoming = Follow-up Date today or later, in the application timezone.
export async function loadFollowUps(userId, { range = "all", search = "" } = {}) {
  await ensureInfluencerSchema();
  const cols = await getInfluencerColumns();
  const today = todayInAppTz();
  const tomorrow = addDaysYmd(today, 1);
  const out = { today, tomorrow, rows: [], available: 0 };
  if (!cols.has("assigned_supervisor_id")) return out;
  await ensureContactDesignationsSchema().catch(() => {});
  const base = "assigned_supervisor_id = ? AND follow_up_date >= ?";
  const baseParams = [userId, today];
  const [{ n }] = await query(`SELECT COUNT(*) AS n FROM influencers WHERE ${base}`, baseParams);
  out.available = Number(n) || 0;
  const where = [base];
  const params = [...baseParams];
  if (range === "today") { where.push("follow_up_date = ?"); params.push(today); }
  else if (range === "tomorrow") { where.push("follow_up_date = ?"); params.push(tomorrow); }
  else if (range === "7" || range === "30") { where.push("follow_up_date <= ?"); params.push(addDaysYmd(today, Number(range))); }
  if (search) { where.push("(name LIKE ? OR phone LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
  const rows = await query(
    `SELECT * FROM influencers WHERE ${where.join(" AND ")} ORDER BY follow_up_date ASC, name ASC, id ASC LIMIT ${MAX_ROWS}`,
    params
  );
  await enrichJoinedBy(rows);
  out.rows = rows.map((r) => {
    const date = String(r.follow_up_date).slice(0, 10);
    return {
      id: r.id, name: r.name, phone: r.phone, photo_url: r.photo_url,
      assembly_name: r.assembly_name, current_party: r.current_party, status: r.status,
      influencer_rating: r.influencer_rating, remark: r.remark, follow_up_date: date,
      joined_by_name: r.joined_by_name || null, joined_by_designation: r.joined_by_designation || null,
      joined_by_phone: r.joined_by_mobile || r.joined_by_phone || null,
      when: date === today ? "today" : date === tomorrow ? "tomorrow" : "upcoming",
      label: date === tomorrow ? "Tomorrow Follow-up" : null,
      label_hi: date === tomorrow ? "कल Follow-up करना है" : null,
    };
  });
  return out;
}
