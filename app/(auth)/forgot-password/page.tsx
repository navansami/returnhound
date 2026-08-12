import { redirect } from "next/navigation";

import { ForgotPasswordForm } from "./forgot-password-form";
import { getSession } from "@/lib/session";

export default async function ForgotPasswordPage() {
  const session = await getSession();
  if (session?.user) redirect("/dashboard");
  return <ForgotPasswordForm />;
}
