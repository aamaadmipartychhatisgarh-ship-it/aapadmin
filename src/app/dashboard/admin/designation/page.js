import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { AlertCircle, UserCog, ChevronRight } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";

// Landing page of the sidebar's "Designation" item. It only links to the two EXISTING pages -
// nothing is duplicated - and lists the ones this user may open, using the SAME checks those
// pages and their APIs use (Contacts access -> Incomplete Designation; "vacancies" -> Designation
// Vacancies). A user with neither is sent back to the dashboard.
export const dynamic = "force-dynamic";

export default async function DesignationLanding() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const admin = isAdmin(session);
  const [vac, inc] = await Promise.all([pageAllowed(session, "vacancies", admin), pageAllowed(session, "contacts", admin)]);
  const options = [
    vac && { key: "vacancies", href: "/dashboard/admin/vacancies", icon: UserCog, title: "Designation Vacancies", text: "Vacant designations across wings and levels, with responsible persons and reminders." },
    inc && { key: "incomplete", href: "/dashboard/admin/contacts-incomplete", icon: AlertCircle, title: "Incomplete Designation", text: "Contacts whose designation details are incomplete and need to be completed." },
  ].filter(Boolean);
  if (!options.length) redirect("/dashboard");

  return (
    <div className="max-w-3xl mx-auto space-y-5" data-testid="designation-landing">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Designation</h1>
        <p className="text-sm text-gray-500 mt-1">Choose what you want to open.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {options.map(({ key, href, icon: Icon, title, text }) => (
          <Link key={key} href={href} data-testid={`designation-option-${key}`}
            className="group bg-white border border-gray-200 hover:border-[#164FA3] hover:shadow-md rounded-2xl p-5 transition flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="w-11 h-11 rounded-xl bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center"><Icon size={22} /></span>
              <ChevronRight size={18} className="text-gray-300 group-hover:text-[#164FA3]" />
            </div>
            <div>
              <div className="font-bold text-gray-900">{title}</div>
              <div className="text-sm text-gray-500 mt-1">{text}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
