import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Sparkles } from "lucide-react";

import { ParseFormButton } from "@/components/draft-parse-button";
import { EntryForm } from "@/components/entry-form";
import { toDatetimeLocal } from "@/lib/dates";
import { RejectDraftButton } from "@/components/draft-actions";
import { Card, CardContent } from "@/components/ui/card";
import { db, schema } from "@/lib/db";
import { canCreateEntry, type Role } from "@/lib/rbac";
import { requireUser } from "@/lib/session";
import { approveDraft } from "@/server/drafts";
import { formParseSchema, parsedToInitial } from "@/lib/validators";

export const dynamic = "force-dynamic";
/** The Gemini parse is a slow external round-trip; give the action room to finish. */
export const maxDuration = 30;

export default async function DraftFillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canCreateEntry(role)) redirect("/drafts");

  const [draft] = await db.select().from(schema.draft).where(eq(schema.draft.id, id)).limit(1);
  if (!draft) notFound();
  if (draft.status !== "pending") redirect("/drafts");

  // OCR results stored by `parseDraft` — validated here so a stale/foreign
  // payload can never reach the form.
  const parsedCheck = draft.parsedData ? formParseSchema.safeParse(draft.parsedData) : null;
  const parsed = parsedCheck?.success ? parsedCheck.data : null;

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
        <div className="flex items-center gap-2">
          <ParseFormButton draftId={draft.id} />
          <RejectDraftButton draftId={draft.id} />
        </div>
      </div>

      {parsed && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
          <Sparkles className="size-4 shrink-0" />
          Fields pre-filled from OCR — review and correct before saving.
        </div>
      )}

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
          // Re-mount when OCR updates `updatedAt` so react-hook-form re-reads
          // the new default values instead of keeping its own state.
          key={draft.updatedAt?.toISOString() ?? "blank"}
          initial={{
            formImage: draft.formImageUrl
              ? { url: draft.formImageUrl, publicId: draft.formImagePublicId ?? "" }
              : null,
            onCreated: async () => {
              await approveDraft(id);
            },
            values: parsedToInitial(parsed, {
              foundAt: toDatetimeLocal(now),
              receivedAt: toDatetimeLocal(now),
              agentName: session.user.name,
            }),
          }}
        />
      </div>
    </div>
  );
}
