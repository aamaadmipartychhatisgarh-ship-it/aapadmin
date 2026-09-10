import { handleRequestOtp } from "@/lib/workerFormOtpHandler";

// POST /api/worker-form/resend-otp  { phone }
// Same rules as request-otp (registered-check → rate-limit → invalidate previous
// → generate/send) — shares one handler so they can never diverge.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req) {
  return handleRequestOtp(req);
}
