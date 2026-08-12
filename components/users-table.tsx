"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ROLES, ROLE_LABELS, type Role } from "@/lib/rbac";
import { updateUser } from "@/server/users";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  department: string | null;
  employeeId: string | null;
  disabled: boolean;
  emailVerified: boolean;
  self: boolean;
};

function UserCell({ user }: { user: UserRow }) {
  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="flex items-center gap-3">
      <Avatar className="size-8">
        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {user.name} {user.self ? <span className="text-muted-foreground">(you)</span> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
      </div>
    </div>
  );
}

export function UsersTable({ users }: { users: UserRow[] }) {
  const router = useRouter();
  const [savingId, setSavingId] = useState<string | null>(null);

  async function save(user: UserRow, patch: Partial<Pick<UserRow, "role" | "department" | "employeeId" | "disabled">>) {
    const next = { role: user.role, department: user.department, employeeId: user.employeeId, disabled: user.disabled, ...patch };
    setSavingId(user.id);
    const res = await updateUser(user.id, next);
    setSavingId(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("User updated");
    router.refresh();
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="hidden sm:table-cell">Department</TableHead>
            <TableHead className="hidden md:table-cell">Employee ID</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell>
                <UserCell user={user} />
              </TableCell>
              <TableCell>
                <Select value={user.role} onValueChange={(v) => save(user, { role: v as Role })}>
                  <SelectTrigger className="h-8 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <Input
                  defaultValue={user.department ?? ""}
                  onBlur={(e) => {
                    if ((e.target.value.trim() || null) !== user.department) save(user, { department: e.target.value.trim() || null });
                  }}
                  className="h-8 w-full min-w-36"
                  placeholder="—"
                />
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Input
                  defaultValue={user.employeeId ?? ""}
                  onBlur={(e) => {
                    if ((e.target.value.trim() || null) !== user.employeeId) save(user, { employeeId: e.target.value.trim() || null });
                  }}
                  className="h-8 w-32"
                  placeholder="—"
                />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Switch checked={!user.disabled} onCheckedChange={(v) => save(user, { disabled: !v })} />
                  <span className={`text-xs ${user.disabled ? "text-destructive" : "text-muted-foreground"}`}>
                    {user.disabled ? "Disabled" : "Active"}
                  </span>
                </div>
              </TableCell>
              <TableCell>{savingId === user.id ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
