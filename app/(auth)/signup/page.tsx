import { redirect } from "next/navigation";

import { SignupForm } from "./signup-form";
import { getSession } from "@/lib/session";

export default async function SignupPage() {
  const session = await getSession();
  if (session?.user) redirect("/dashboard");
  return <SignupForm />;
}
