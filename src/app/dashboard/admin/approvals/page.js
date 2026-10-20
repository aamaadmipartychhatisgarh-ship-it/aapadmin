import { redirect } from "next/navigation";

// The Designation Approval UI was removed (UI FIX 34). The route stays only so
// old links — e.g. earlier approval notifications — land on the dashboard instead
// of a 404. Approval data, its API and anything that reads final approvals
// (Area Ranking) are unchanged.
export default function DesignationApprovalRemoved() {
  redirect("/dashboard");
}
