// Links created before the common sharing system covered Excel/CSV used /api/pdf-share/<token>; same handler, same security.
export { GET } from "@/app/api/file-share/[token]/route";
export const dynamic = "force-dynamic";
