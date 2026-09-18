import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { seedAssemblyBlocks } from "@/lib/politicalLocation";

// POST /api/master-data/seed-blocks — add/verify the required Assembly → Block
// master mapping (§13). Idempotent: matches existing assemblies by name, creates
// only the missing Blocks (no duplicate assemblies or blocks), and reports what it
// did. Admin only.
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const report = await seedAssemblyBlocks();
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    console.error("seed-blocks error:", e);
    return NextResponse.json({ message: "Could not seed the block mapping." }, { status: 500 });
  }
}
