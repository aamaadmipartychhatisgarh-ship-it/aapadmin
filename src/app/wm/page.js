"use client";

// The installed PWA opens here. Renders the SAME Worker & Membership experience
// as the dashboard route, in standalone "app" mode (compact header + bottom nav).
// Auth + data come from the existing session/APIs; a non-Super-Admin sees the
// Access Denied screen the component renders, and the backend still returns 403.
import WorkerMembershipApp from "@/components/worker-membership/WorkerMembershipApp";

export default function WmPage() {
  return <WorkerMembershipApp standalone />;
}
