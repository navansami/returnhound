"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { CATEGORIES, STORAGE_LOCATIONS, type EntryInput } from "@/lib/validators";
import { CATEGORY_LABELS, STORAGE_LABELS } from "@/lib/labels";
import { createEntry, updateEntry } from "@/server/entries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ImageUpload, type UploadedImage } from "@/components/image-upload";
import { SignaturePadInput } from "@/components/signature-pad";

const itemSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Item name is required").max(200),
  description: z.string().trim().max(2000),
  category: z.enum(CATEGORIES),
  imageUrl: z.string().nullable(),
  imagePublicId: z.string().nullable(),
});

const formSchema = z.object({
  foundAt: z.string().min(1, "Found date & time is required"),
  receivedAt: z.string(),
  foundLocation: z.string().trim().min(1, "Found location is required").max(300),
  finderName: z.string().trim().min(1, "Finder name is required").max(200),
  finderDepartment: z.string().trim().max(200),
  finderEmployeeId: z.string().trim().max(100),
  agentName: z.string().trim().max(200),
  storageLocation: z.enum(STORAGE_LOCATIONS),
  storageDetail: z.string().trim().max(300),
  isValuable: z.boolean(),
  comments: z.string().trim().max(4000),
  items: z.array(itemSchema).min(1, "Add at least one item").max(20, "Maximum 20 items per form"),
});

type FormValues = z.infer<typeof formSchema>;
type ItemRow = z.infer<typeof itemSchema>;

export type EntryFormInitial = {
  entryId?: string;
  rsNumber?: string;
  /** Existing agent signature shown in edit mode. */
  agentSignature?: string | null;
  formImage?: UploadedImage;
  /** Called after a successful create — e.g. to approve the source draft. */
  onCreated?: (entryId: string) => Promise<void>;
  values: FormValues;
};

const emptyItem = (): ItemRow => ({
  name: "",
  description: "",
  category: "general",
  imageUrl: null,
  imagePublicId: null,
});

export function EntryForm({ initial }: { initial: EntryFormInitial }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formImage, setFormImage] = useState<UploadedImage>(initial.formImage ?? null);
  const [agentSignature, setAgentSignature] = useState<string | null>(initial.agentSignature ?? null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initial.values,
  });

  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const storageLocation = watch("storageLocation");

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    const payload: EntryInput = {
      foundAt: new Date(values.foundAt),
      foundLocation: values.foundLocation,
      finderName: values.finderName,
      finderDepartment: values.finderDepartment || null,
      finderEmployeeId: values.finderEmployeeId || null,
      receivedAt: values.receivedAt ? new Date(values.receivedAt) : null,
      agentName: values.agentName || null,
      agentSignature,
      storageLocation: values.storageLocation,
      storageDetail: values.storageDetail || null,
      isValuable: values.isValuable || values.storageLocation === "security",
      comments: values.comments || null,
      formImageUrl: formImage?.url ?? null,
      formImagePublicId: formImage?.publicId ?? null,
      items: values.items.map((it) => ({
        id: it.id || undefined,
        name: it.name,
        description: it.description || null,
        category: it.category,
        imageUrl: it.imageUrl,
        imagePublicId: it.imagePublicId,
      })),
    };

    const result = initial.entryId ? await updateEntry(initial.entryId, payload) : await createEntry(payload);
    if (!result.ok) {
      toast.error(result.error);
      setSubmitting(false);
      return;
    }
    if (!initial.entryId && initial.onCreated) {
      try {
        await initial.onCreated(result.entryId);
      } catch {
        // Non-blocking: entry was created; draft approval failure is surfaced via audit.
      }
    }
    toast.success(initial.entryId ? "Entry updated" : `${result.rsNumber} logged`);
    router.push(`/entries/${result.entryId}`);
    router.refresh();
  }

  const fieldErr = (msg: string | undefined) =>
    msg ? <p className="mt-1 text-xs text-destructive">{msg}</p> : null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Finder & found details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Found details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="foundAt">Found date &amp; time *</Label>
              <Input id="foundAt" type="datetime-local" {...register("foundAt")} />
              {fieldErr(errors.foundAt?.message)}
            </div>
            <div>
              <Label htmlFor="receivedAt">Received by agent</Label>
              <Input id="receivedAt" type="datetime-local" {...register("receivedAt")} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="foundLocation">Found location *</Label>
              <Input
                id="foundLocation"
                placeholder="e.g. Beach, Pool, Lobby, Restroom"
                {...register("foundLocation")}
              />
              {fieldErr(errors.foundLocation?.message)}
            </div>
            <div>
              <Label htmlFor="finderName">Finder name *</Label>
              <Input id="finderName" placeholder="Who handed it in" {...register("finderName")} />
              {fieldErr(errors.finderName?.message)}
            </div>
            <div>
              <Label htmlFor="finderDepartment">Finder department</Label>
              <Input id="finderDepartment" {...register("finderDepartment")} />
            </div>
            <div>
              <Label htmlFor="finderEmployeeId">Finder employee ID</Label>
              <Input id="finderEmployeeId" {...register("finderEmployeeId")} />
            </div>
            <div>
              <Label htmlFor="agentName">Agent (Lost &amp; Found)</Label>
              <Input id="agentName" placeholder="Who received it" {...register("agentName")} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Storage & value */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Storage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Storage location</Label>
              <Select
                value={storageLocation}
                onValueChange={(v) => setValue("storageLocation", v as FormValues["storageLocation"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STORAGE_LABELS) as (keyof typeof STORAGE_LABELS)[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {STORAGE_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">Anything held in Security counts as valuable.</p>
            </div>
            <div>
              <Label htmlFor="storageDetail">Detail (cupboard / shelf)</Label>
              <Input id="storageDetail" placeholder="e.g. Cupboard A, shelf 2" {...register("storageDetail")} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="isValuable">Valuable</Label>
              <p className="text-xs text-muted-foreground">Jewellery, electronics, currency, documents…</p>
            </div>
            <Switch
              id="isValuable"
              checked={storageLocation === "security" || watch("isValuable")}
              onCheckedChange={(v) => setValue("isValuable", v)}
              disabled={storageLocation === "security"}
            />
          </div>
          <div>
            <Label htmlFor="comments">Comments</Label>
            <Textarea id="comments" rows={3} placeholder="Any notes about the find" {...register("comments")} />
          </div>
        </CardContent>
      </Card>

      {/* Items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Items ({fields.length})</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={fields.length >= 20}
            onClick={() => append(emptyItem())}
          >
            <Plus className="size-3.5" /> Add item
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {errors.items?.message ? <p className="text-sm text-destructive">{errors.items.message}</p> : null}
          {fields.map((field, index) => (
            <div key={field.id} className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium">Item {index + 1}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => remove(index)}
                >
                  <Trash2 className="size-3.5" /> Remove
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Item name *</Label>
                  <Input placeholder="e.g. iPhone 15, black wallet" {...register(`items.${index}.name`)} />
                  {fieldErr(errors.items?.[index]?.name?.message)}
                </div>
                <div>
                  <Label>Category</Label>
                  <Select
                    // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form's watch is the intended controlled-Select pattern
                    value={watch(`items.${index}.category`)}
                    onValueChange={(v) => setValue(`items.${index}.category`, v as ItemRow["category"])}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {CATEGORY_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Label>Description</Label>
                  <Textarea rows={2} placeholder="Brand, colour, distinguishing marks" {...register(`items.${index}.description`)} />
                </div>
                <div className="sm:col-span-2">
                  <ImageUpload
                    folder={`entries/${initial.entryId ?? "new"}`}
                    capture="environment"
                    value={
                      watch(`items.${index}.imageUrl`)
                        ? { url: watch(`items.${index}.imageUrl`)!, publicId: watch(`items.${index}.imagePublicId`) ?? "" }
                        : null
                    }
                    onChange={(v) => {
                      setValue(`items.${index}.imageUrl`, v?.url ?? null);
                      setValue(`items.${index}.imagePublicId`, v?.publicId ?? null);
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Sign-off & form photo */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sign-off</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <Label>Agent signature</Label>
              {agentSignature ? (
                <div className="mb-2 rounded-lg border bg-white p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/svg+xml;utf8,${encodeURIComponent(agentSignature)}`}
                    alt="Current signature"
                    className="h-16"
                  />
                  <p className="text-xs text-muted-foreground">Draw below to replace it.</p>
                </div>
              ) : null}
              <SignaturePadInput onChange={setAgentSignature} />
            </div>
            <div>
              <Label>Paper form photo</Label>
              <ImageUpload folder="forms" value={formImage} onChange={setFormImage} />
              <p className="mt-1 text-xs text-muted-foreground">
                Photo of the original RS form (optional but recommended).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          {initial.entryId ? "Save changes" : "Log entry"}
        </Button>
      </div>
    </form>
  );
}
