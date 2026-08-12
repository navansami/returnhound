import { AppShell } from "@/components/app-shell";
import { type Role } from "@/lib/rbac";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  return (
    <AppShell
      user={{
        name: session.user.name,
        email: session.user.email,
        role: (session.user.role ?? "moderator") as Role,
      }}
    >
      {children}
    </AppShell>
  );
}
