import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import {
  CHAINS, CHAIN_LEVELS, LEVEL_LABEL,
  ensureDesignationChainSchema, getStateNode, listChildSlots, candidatesForSlot,
  appointChain, vacateChain, chainSummary,
} from "@/lib/designationChain";

// Administration → Designation Chain API. GET reads the chain tree (lazily, one
// node's children at a time), candidate people for a slot, and the summary; POST
// appoints or vacates a slot. Gated by the Master Data page permission (Super
// Admin always) — the same gate as the Designation Master it builds on.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

async function guard() {
  const session = await getServerSession(authOptions);
  if (!(await pageAllowed(session, "master_data", session && isAdmin(session)))) {
    return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE }) };
  }
  return { session };
}

export async function GET(req) {
  try {
    const { error } = await guard();
    if (error) return error;
    await ensureDesignationChainSchema();
    const sp = new URL(req.url).searchParams;
    const chain = String(sp.get("chain") || "president");
    if (!CHAINS.some((c) => c.key === chain)) {
      return NextResponse.json({ message: "Unknown chain." }, { status: 400, headers: NO_STORE });
    }
    const level = sp.get("level");
    const locationId = sp.get("location_id") ? parseInt(sp.get("location_id"), 10) : null;

    // Candidate people for a specific slot (the appoint picker).
    if (sp.get("candidates") === "1") {
      if (!level || !CHAIN_LEVELS.includes(level)) return NextResponse.json({ message: "Invalid level." }, { status: 400, headers: NO_STORE });
      const candidates = await candidatesForSlot(chain, level, locationId, sp.get("search") || "");
      return NextResponse.json({ candidates }, { headers: NO_STORE });
    }

    // Children of a node (lazy expand). No level → the State root + its children.
    if (!level || level === "state") {
      const root = await getStateNode(chain);
      const { childLevel, slots } = await listChildSlots(chain, "state", null);
      const summary = await chainSummary(chain);
      return NextResponse.json({
        chain, chains: CHAINS, levels: CHAIN_LEVELS, level_labels: LEVEL_LABEL,
        root, child_level: childLevel, children: slots, summary,
      }, { headers: NO_STORE });
    }

    const { childLevel, slots } = await listChildSlots(chain, level, locationId);
    const summary = await chainSummary(chain);
    return NextResponse.json({ chain, level, location_id: locationId, child_level: childLevel, children: slots, summary }, { headers: NO_STORE });
  } catch (err) {
    console.error("[chain] GET error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req) {
  try {
    const { session, error } = await guard();
    if (error) return error;
    await ensureDesignationChainSchema();
    const d = await req.json().catch(() => ({}));
    const action = String(d?.action || "");
    const args = { chainKey: d.chain, level: d.level, locationId: d.location_id, contactId: d.contact_id };

    let result;
    if (action === "appoint") result = await appointChain(session, args);
    else if (action === "vacate") result = await vacateChain(session, args);
    else return NextResponse.json({ message: "Unknown action." }, { status: 400, headers: NO_STORE });

    if (result?.error) return NextResponse.json({ message: result.error }, { status: 400, headers: NO_STORE });
    return NextResponse.json({ ok: true, id: result?.id ?? null }, { headers: NO_STORE });
  } catch (err) {
    console.error("[chain] POST error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
