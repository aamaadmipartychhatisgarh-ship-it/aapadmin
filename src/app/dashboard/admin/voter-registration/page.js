"use client";

// Voter & Worker Registration — the admin console for the public link drive.
// The whole experience lives in one component so the route stays a thin shell,
// matching the other recent modules (Worker & Membership, Influencers).
import RegistrationApp from "@/components/registration/RegistrationApp";

export default function VoterRegistrationPage() {
  return <RegistrationApp />;
}
