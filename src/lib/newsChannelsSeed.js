import { query } from "@/lib/db";

// Lazy, idempotent seed for the Media → News Channels master list, mirroring the
// newspaper seed in pressNotesSchema.js. The debate "Channel" dropdown, the
// Media analytics tone breakdown and the Reports debates module all read
// news_channels, so if that table is empty (a deploy where the one-off
// add-media-schema migration never ran, or the seed block was skipped because
// the table already existed empty) the Channel dropdown shows nothing. This runs
// on the Media hub load so the master list is always populated — without
// hardcoding channel names in the frontend. Runs once per process.
//
// The starter list matches scripts/add-media-schema.mjs. It is only inserted
// when the table is EMPTY, so admins who curate their own channels (add via the
// News Channels tab, delete the defaults) are never re-seeded over.
let ensured = false;

const DEFAULT_CHANNELS = [
  ["IBC24", "supportive"],
  ["News18 Chhattisgarh", "neutral"],
  ["Zee Madhya Pradesh Chhattisgarh", "neutral"],
  ["DD Chhattisgarh", "neutral"],
  ["Sahara Samay CG", "supportive"],
];

export async function ensureNewsChannelsSeed() {
  if (ensured) return;
  try {
    const [{ n } = { n: 0 }] = await query("SELECT COUNT(*) AS n FROM news_channels");
    if (Number(n) === 0) {
      for (let i = 0; i < DEFAULT_CHANNELS.length; i++) {
        // INSERT IGNORE so a UNIQUE(name) clash (concurrent seed) is harmless.
        await query(
          "INSERT IGNORE INTO news_channels (name, tone, sort_order) VALUES (?, ?, ?)",
          [DEFAULT_CHANNELS[i][0], DEFAULT_CHANNELS[i][1], i]
        );
      }
    }
    ensured = true;
  } catch (e) {
    console.error("[media] ensureNewsChannelsSeed:", e?.message || e);
  }
}
