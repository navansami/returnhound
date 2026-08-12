import { redirect } from "next/navigation";

import { EntryForm } from "@/components/entry-form";
import { toDatetimeLocal } from "@/lib/dates";
import { canCreateEntry, type Role } from "@/lib/rbac";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewEntryPage() {
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canCreateEntry(role)) redirect("/entries");

  const now = new Date();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Log a new entry</h1>
        <p className="text-sm text-muted-foreground">One paper RS form = one entry with up to 20 items.</p>
      </div>
      <EntryForm
        initial={{
          values: {
            foundAt: toDatetimeLocal(now),
            receivedAt: toDatetimeLocal(now),
            foundLocation: "",
            finderName: "",
            finderDepartment: "",
            finderEmployeeId: "",
            agentName: session.user.name,
            storageLocation: "lost_found_store",
            storageDetail: "",
            isValuable: false,
            comments: "",
            items: [{ name: "", description: "", category: "general", imageUrl: null, imagePublicId: null }],
          },
        }}
      />
    </div>
  );
}
