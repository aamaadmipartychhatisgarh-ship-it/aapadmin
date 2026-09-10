import { publicFormContext, submitPublicRegistration, publicOwnList } from "@/lib/publicRegistration";

// Token-addressed public form endpoints — a personal karyakarta link, or a link
// pinned to one specific drive. The open /join link uses the sibling route with
// no token; both are thin wrappers over the same handlers, so they cannot drift.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET(req, { params }) {
  const { token } = await params;
  const list = new URL(req.url).searchParams.get("list");
  if (list) return publicOwnList(req, token, list);
  return publicFormContext(token);
}

export async function POST(req, { params }) {
  const { token } = await params;
  return submitPublicRegistration(req, token);
}
