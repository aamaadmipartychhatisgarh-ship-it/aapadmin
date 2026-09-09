import { publicFormContext, submitPublicRegistration } from "@/lib/publicRegistration";

// The standing public form endpoint behind /join — no token at all. It resolves
// to whichever drive is currently active, so the same URL can be printed,
// forwarded and pinned in a WhatsApp group forever: closing the drive switches
// the link off, and opening the next one switches it back on.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET() {
  return publicFormContext(null);
}

export async function POST(req) {
  return submitPublicRegistration(req, null);
}
