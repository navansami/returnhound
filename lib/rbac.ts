export const ROLES = ["admin", "editor", "security", "moderator"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  editor: "Editor",
  security: "Security",
  moderator: "Moderator",
};

/** Moderators are strictly read-only. Security may log items that end up as valuable. */
export function canCreateEntry(role: Role): boolean {
  return role === "admin" || role === "editor" || role === "security";
}

/**
 * Editors and admins manage everything. Security may only manage entries that
 * are flagged valuable (anything handed to Security).
 */
export function canManageEntry(role: Role, isValuable: boolean): boolean {
  if (role === "admin" || role === "editor") return true;
  if (role === "security") return isValuable;
  return false;
}

export function canDeleteEntry(role: Role): boolean {
  return role === "admin";
}

export function canManageUsers(role: Role): boolean {
  return role === "admin";
}

export function canManageSettings(role: Role): boolean {
  return role === "admin";
}

export function canImport(role: Role): boolean {
  return role === "admin" || role === "editor";
}

export function canRunReports(role: Role): boolean {
  return role === "admin" || role === "editor";
}
