import { recordOwnContactAction } from "@/lib/publicRegistration";

// POST { id, action } — same as /api/public/registration/contact-action, for a
// personal / drive link (the link's own karyakarta only).
export const dynamic = "force-dynamic";

export async function POST(req, { params }) {
  const { token } = await params;
  return recordOwnContactAction(req, token);
}
