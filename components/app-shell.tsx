"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  FileText,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  PlusCircle,
  Search,
  Settings,
  Upload,
  Users,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { ROLE_LABELS, type Role } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

type NavUser = { name: string; email: string; role: Role };

const NAV_ICONS = { Dashboard: LayoutDashboard, Entries: Search, "New entry": PlusCircle, "Form drafts": FileText, Import: Upload, Reports: BarChart3, Users, Settings } as const;

function navFor(role: Role) {
  const items: { href: string; label: keyof typeof NAV_ICONS; show: boolean }[] = [
    { href: "/dashboard", label: "Dashboard", show: true },
    { href: "/entries", label: "Entries", show: true },
    { href: "/entries/new", label: "New entry", show: role === "admin" || role === "editor" || role === "security" },
    { href: "/drafts", label: "Form drafts", show: role === "admin" || role === "editor" || role === "security" },
    { href: "/imports", label: "Import", show: role === "admin" || role === "editor" },
    { href: "/reports", label: "Reports", show: role === "admin" || role === "editor" },
    { href: "/users", label: "Users", show: role === "admin" },
    { href: "/settings", label: "Settings", show: role === "admin" },
  ];
  return items.filter((i) => i.show);
}

function NavList({ user, onNavigate }: { user: NavUser; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-1 px-3 py-3">
      {navFor(user.role).map((item) => {
        const Icon = NAV_ICONS[item.label];
        const active = item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserMenu({ user }: { user: NavUser }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function handleSignOut() {
    setPending(true);
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent">
          <Avatar className="size-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          </span>
          <Badge variant="secondary" className="capitalize">
            {ROLE_LABELS[user.role]}
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>
          <span className="block text-sm font-medium">{user.name}</span>
          <span className="block text-xs font-normal text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} disabled={pending} className="text-destructive focus:text-destructive">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Brand() {
  return (
    <div className="m-3 flex items-center gap-3 rounded-xl bg-gradient-to-br from-[#55a0dc] via-[#418bca] to-[#2e6ea0] p-3.5 text-white shadow-sm">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/20">
        <Search className="size-5" />
      </span>
      <div className="leading-tight">
        <p className="text-sm font-semibold">Lost &amp; Found</p>
        <p className="text-[11px] text-white/80">Fairmont The Palm</p>
      </div>
    </div>
  );
}

export function AppShell({ user, children }: { user: NavUser; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-dvh md:flex md:h-dvh md:overflow-hidden">
      {/* Desktop sidebar — pinned to the viewport, never scrolls with the content */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-muted/40 md:flex md:overflow-y-auto">
        <Brand />
        <NavList user={user} />
        <div className="border-t p-2">
          <UserMenu user={user} />
        </div>
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="flex min-w-0 flex-1 flex-col md:min-h-0 md:overflow-y-auto">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/90 px-4 py-2.5 backdrop-blur md:hidden">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Search className="size-4" />
            </span>
            <span className="text-sm font-semibold">Lost &amp; Found</span>
          </div>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-72 flex-col p-0">
              <Brand />
              <NavList user={user} onNavigate={() => setOpen(false)} />
              <div className="border-t p-2">
                <UserMenu user={user} />
              </div>
            </SheetContent>
          </Sheet>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
