import PublicRegistrationForm from "@/components/registration/PublicRegistrationForm";

// The public, shareable registration link: /r/<token>. One token per karyakarta,
// so whoever submits here is automatically credited to that worker. No login —
// the token is the only thing that identifies the collector, and it grants access
// to nothing except this form (see /api/public/registration/[token]).
export const dynamic = "force-dynamic";

export const metadata = {
  title: "मतदाता एवं कार्यकर्ता पंजीयन — आम आदमी पार्टी छत्तीसगढ़",
  description: "Aam Aadmi Party Chhattisgarh — Voter & Worker Registration",
  robots: { index: false, follow: false },
};

export default async function PublicRegistrationPage({ params }) {
  const { token } = await params;
  return <PublicRegistrationForm token={token} />;
}
