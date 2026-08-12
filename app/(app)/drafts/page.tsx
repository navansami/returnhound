import Link from "next/link";
import { desc } from "drizzle-orm";
import { format } from "date-fns";
import { FileQuestion } from "lucide-react";

import { DraftUpload } from "@/components/draft-upload";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db, schema } from "@/lib/db";
import { canCreateEntry, type Role } from "@/lib/rbac";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const DRAFT_LABELS: Record<string, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

export default async function DraftsPage() {
  const session = await requireUser();
  const role = session.user.role as Role;
  const canCreate = canCreateEntry(role);

  const drafts = await db
    .select({
      id: schema.draft.id,
      formImageUrl: schema.draft.formImageUrl,
      status: schema.draft.status,
      createdAt: schema.draft.createdAt,
    })
    .from(schema.draft)
    .orderBy(desc(schema.draft.createdAt))
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Form drafts</h1>
        <p className="text-sm text-muted-foreground">Paper forms awaiting entry. Fill them in on the desktop app.</p>
      </div>

      {canCreate ? <DraftUpload /> : null}

      {drafts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <FileQuestion className="size-8 text-muted-foreground" />
            <p className="font-medium">No drafts</p>
            <p className="text-sm text-muted-foreground">Photograph a form to create one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {drafts.map((d) => (
            <Link key={d.id} href={`/drafts/${d.id}`} className="group">
              <Card className="overflow-hidden transition-shadow group-hover:shadow-md">
                <div className="grid aspect-[3/4] place-items-center overflow-hidden bg-muted">
                  {d.formImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.formImageUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <FileQuestion className="size-8 text-muted-foreground" />
                  )}
                </div>
                <CardContent className="flex items-center justify-between p-3">
                  <span className="text-xs text-muted-foreground">{format(d.createdAt, "dd MMM, HH:mm")}</span>
                  <Badge variant={d.status === "pending" ? "default" : d.status === "approved" ? "secondary" : "outline"}>
                    {DRAFT_LABELS[d.status]}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Button asChild variant="link" className="px-0">
        <Link href="/entries">Skip drafts — log directly</Link>
      </Button>
    </div>
  );
}
