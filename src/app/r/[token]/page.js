import PublicRegistrationForm from "@/components/registration/PublicRegistrationForm";
import RegistrationPwa from "@/components/registration/RegistrationPwa";
import { registrationAppMetadata } from "@/lib/registrationAppMeta";

// The public, shareable registration link: /r/<token>. One token per karyakarta,
// so whoever submits here is automatically credited to that worker. No login —
// the token is the only thing that identifies the collector, and it grants access
// to nothing except this form (see /api/public/registration/[token]).
export const dynamic = "force-dynamic";

export const metadata = registrationAppMetadata;

export default async function PublicRegistrationPage({ params }) {
  const { token } = await params;
  return <><RegistrationPwa /><PublicRegistrationForm token={token} /></>;
}
