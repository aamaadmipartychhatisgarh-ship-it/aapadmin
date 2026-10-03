"use client";

// Voter & Worker Registration — the admin console for the public link drive.
// The whole experience lives in one component so the route stays a thin shell,
// matching the other recent modules (Worker & Membership, Influencers).
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import RegistrationApp from "@/components/registration/RegistrationApp";

// RegistrationApp reads ?tab= via useSearchParams, so it must sit under a Suspense
// boundary (Next bails the subtree to client rendering and the build would
// otherwise fail with "Missing Suspense boundary with useSearchParams").
export default function VoterRegistrationPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>}>
      <RegistrationApp />
    </Suspense>
  );
}
