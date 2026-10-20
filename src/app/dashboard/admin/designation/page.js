import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";

// The sidebar "Designation" section's own link. There is no separate page: it
// opens the first designation page this user may access, using the SAME checks
// those pages and their APIs use (Contacts access → Incomplete Designation;
// "vacancies" → Designation Vacancies).
export const dynamic = "force-dynamic";

export default async function DesignationSection() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const admin = isAdmin(session);
  if (await pageAllowed(session, "contacts", admin)) redirect("/dashboard/admin/contacts-incomplete");
  if (await pageAllowed(session, "vacancies", admin)) redirect("/dashboard/admin/vacancies");
  redirect("/dashboard");
}
