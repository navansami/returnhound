"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { ROLES, ROLE_LABELS, type Role } from "@/lib/rbac";
import { createUser, updateUser } from "@/server/users";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
        <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <span className="truncate">{user.email}</span>
          {user.emailVerified ? (
            <Badge variant="outline" className="shrink-0 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
              Verified
            </Badge>
          ) : null}
        </p>
      </div>
    </div>
  );
}

export function AddUserDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("moderator");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return toast.error("Name is required");
    if (!email.trim()) return toast.error("Work email is required");
    if (password.length < 8) return toast.error("Password must be at least 8 characters");

    setSaving(true);
    const res = await createUser({ name, email, password, role });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("User added — verified by default");
    setOpen(false);
    setName("");
    setEmail("");
    setPassword("");
    setRole("moderator");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="size-4" />
          Add user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a new user</DialogTitle>
          <DialogDescription>
            New accounts are verified by default — they can sign in right away. Pick any role.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-user-name">Full name</Label>
            <Input id="new-user-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-user-email">Work email</Label>
            <Input id="new-user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane.doe@fairmont.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-user-password">Temporary password</Label>
            <Input id="new-user-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
            <p className="text-xs text-muted-foreground">The user can reset this after signing in.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger className="w-full">
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
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleCreate} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Create user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
