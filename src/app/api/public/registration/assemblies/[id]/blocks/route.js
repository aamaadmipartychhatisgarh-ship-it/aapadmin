import { NextResponse } from "next/server";
import { blocksForAssembly } from "@/lib/politicalLocation";

// GET /api/public/registration/assemblies/{id}/blocks
// The public Worker Data Collection Form's dependent Block dropdown. Returns ONLY
// the Blocks mapped to this Assembly (by the stored parent_id) from the existing
// Political Location master — never all blocks filtered on the client, and never a
// hardcoded mapping. Public (the form is unauthenticated) and read-only; it exposes
// only non-sensitive location names. Inactive Blocks are omitted so they cannot be
// picked. Unknown/empty assembly → an empty list (the form shows "No Blocks").
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(_req, { params }) {
  try {
    const { id } = await params;
    const all = await blocksForAssembly(id);
    const blocks = all.filter((b) => String(b.status || "active") !== "inactive");
    return NextResponse.json({ assembly_id: Number(id) || null, blocks }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[public] assembly blocks GET error:", e);
    return NextResponse.json({ assembly_id: null, blocks: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
