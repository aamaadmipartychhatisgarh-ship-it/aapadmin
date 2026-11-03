import PublicRegistrationForm from "@/components/registration/PublicRegistrationForm";
import RegistrationPwa from "@/components/registration/RegistrationPwa";
import { registrationAppMetadata } from "@/lib/registrationAppMeta";

// THE public link: /join — one fixed URL to print, forward and pin, for the
// whole state. It always opens the currently active registration drive, and a
// karyakarta identifies themselves with their own mobile number, so nothing has
// to be issued per person and the URL never changes between drives.
export const dynamic = "force-dynamic";

export const metadata = registrationAppMetadata;

export default function JoinPage() {
  return <><RegistrationPwa /><PublicRegistrationForm /></>;
}
