import { desc } from "drizzle-orm";

import { UsersTable } from "@/components/users-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db, schema } from "@/lib/db";
import { canManageUsers, type Role } from "@/lib/rbac";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const { session } = await requireRole("admin");
  const role = session.user.role as Role;
  if (!canManageUsers(role)) return null;

  const users = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.user.role,
      department: schema.user.department,
      employeeId: schema.user.employeeId,
      disabled: schema.user.disabled,
      emailVerified: schema.user.emailVerified,
    })
    .from(schema.user)
    .orderBy(desc(schema.user.createdAt));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">Manage roles, departments, and account access.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{users.length} account{users.length === 1 ? "" : "s"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <UsersTable users={users.map((u) => ({ ...u, self: u.id === session.user.id }))} />
        </CardContent>
      </Card>
    </div>
  );
}
