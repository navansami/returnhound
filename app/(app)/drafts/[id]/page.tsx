import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { EntryForm } from "@/components/entry-form";
import { toDatetimeLocal } from "@/lib/dates";
import { RejectDraftButton } from "@/components/draft-actions";
import { Card, CardContent } from "@/components/ui/card";
import { db, schema } from "@/lib/db";
import { canCreateEntry, type Role } from "@/lib/rbac";
import { requireUser } from "@/lib/session";
import { approveDraft } from "@/server/drafts";

export const dynamic = "force-dynamic";

export default async function DraftFillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canCreateEntry(role)) redirect("/drafts");

  const [draft] = await db.select().from(schema.draft).where(eq(schema.draft.id, id)).limit(1);
  if (!draft) notFound();
  if (draft.status !== "pending") redirect("/drafts");

  const now = new Date();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Complete draft</h1>
          <p className="text-sm text-muted-foreground">
            Fill in the fields from the photographed form. Logging the entry marks the draft as approved.
          </p>
        </div>
        <RejectDraftButton draftId={draft.id} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit overflow-hidden">
          <CardContent className="p-0">
            {draft.formImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={draft.formImageUrl} alt="Paper RS form" className="w-full" />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">No form photo.</p>
            )}
          </CardContent>
        </Card>

        <EntryForm
          initial={{
            formImage: draft.formImageUrl
              ? { url: draft.formImageUrl, publicId: draft.formImagePublicId ?? "" }
              : null,
            onCreated: async () => {
              await approveDraft(id);
            },
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
    </div>
  );
}
