"use client";

// Worker & Membership Management — inside the Super Admin dashboard (browser).
// The whole experience lives in a shared component so the installable PWA entry
// at /wm can reuse it verbatim (same backend/DB, no duplication).
import WorkerMembershipApp from "@/components/worker-membership/WorkerMembershipApp";

export default function WorkerMembershipPage() {
  return <WorkerMembershipApp />;
}
