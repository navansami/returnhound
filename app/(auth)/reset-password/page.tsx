import { redirect } from "next/navigation";

import { ResetPasswordForm } from "./reset-password-form";
import { getSession } from "@/lib/session";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (session?.user) redirect("/dashboard");

  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";

  return <ResetPasswordForm token={token} />;
}
