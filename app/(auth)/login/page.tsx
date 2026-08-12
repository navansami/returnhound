import { redirect } from "next/navigation";

import { LoginForm } from "./login-form";
import { getSession } from "@/lib/session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (session?.user) redirect("/dashboard");

  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/dashboard";

  return <LoginForm next={next} />;
}
