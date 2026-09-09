import PublicRegistrationForm from "@/components/registration/PublicRegistrationForm";

// THE public link: /join — one fixed URL to print, forward and pin, for the
// whole state. It always opens the currently active registration drive, and a
// karyakarta identifies themselves with their own mobile number, so nothing has
// to be issued per person and the URL never changes between drives.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "मतदाता एवं कार्यकर्ता पंजीयन — आम आदमी पार्टी छत्तीसगढ़",
  description: "Aam Aadmi Party Chhattisgarh — Voter & Worker Registration",
  robots: { index: false, follow: false },
};

export default function JoinPage() {
  return <PublicRegistrationForm />;
}
