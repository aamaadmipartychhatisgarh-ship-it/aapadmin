import { handleRequestOtp } from "@/lib/workerFormOtpHandler";

// POST /api/worker-form/request-otp  { phone }
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req) {
  return handleRequestOtp(req);
}
