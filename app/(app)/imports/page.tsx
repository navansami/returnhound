import { ImportTool } from "@/components/import-tool";
import { requireUser } from "@/lib/session";
import { canImport, type Role } from "@/lib/rbac";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canImport(role)) redirect("/dashboard");

  return <ImportTool />;
}
