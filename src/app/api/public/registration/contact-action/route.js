import { recordOwnContactAction } from "@/lib/publicRegistration";

// POST { id, action: call|sms|whatsapp } — the signed-in karyakarta initiated a
// communication action on one of their own registrations (/join link).
export const dynamic = "force-dynamic";

export async function POST(req) {
  return recordOwnContactAction(req, null);
}
