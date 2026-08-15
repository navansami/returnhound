"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ID_TYPES } from "@/lib/validators";
import { ID_TYPE_LABELS } from "@/lib/labels";
import type { ParsedId } from "@/lib/id-mrz";
import { collectItem, discardItem, enquireEntry, policeHandover } from "@/server/lifecycle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePadInput } from "@/components/signature-pad";

// Tesseract + its language model are ~10 MB, so the scanner is loaded on
// demand (only when the collection dialog is opened) and client-side only.
const IdScanner = dynamic(() => import("@/components/id-scanner").then((m) => m.IdScanner), {
  ssr: false,
});

type ItemTarget = { id: string; name: string; status: string };

function useDialogState() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  return { router, open, setOpen, submitting, setSubmitting };
}

function SubmitButton({ submitting, label }: { submitting: boolean; label: string }) {
  return (
    <Button type="submit" disabled={submitting} className="w-full">
      {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

const err = (msg: string | undefined) => (msg ? <p className="mt-1 text-xs text-destructive">{msg}</p> : null);

/* ------------------------------ Collection ------------------------------ */

const collectionFormSchema = z.object({
  guestName: z.string().trim().min(1, "Guest name is required").max(200),
  idType: z.enum(ID_TYPES),
  idNumber: z.string().trim().min(1, "ID number is required").max(100),
  contact: z.string().trim().min(1, "Contact number is required").max(100),
  signature: z.string().min(1, "Guest signature is required"),
});
type CollectionForm = z.input<typeof collectionFormSchema>;

export function CollectionDialog({ item, canEdit }: { item: ItemTarget; canEdit: boolean }) {
  const { router, open, setOpen, submitting, setSubmitting } = useDialogState();
  const form = useForm<CollectionForm>({
    resolver: zodResolver(collectionFormSchema),
    defaultValues: { guestName: "", idType: "emirates_id", idNumber: "", contact: "", signature: "" },
  });
  const { register, handleSubmit, setValue, formState, watch } = form;

  /** Pre-fill the guest identity fields from an on-device MRZ scan. */
  const handleScan = (parsed: ParsedId) => {
    setValue("guestName", parsed.name, { shouldValidate: true });
    setValue("idType", parsed.idType, { shouldValidate: true });
    setValue("idNumber", parsed.idNumber, { shouldValidate: true });
  };

  const onSubmit = async (values: CollectionForm) => {
    setSubmitting(true);
    const res = await collectItem(item.id, values);
    if (!res.ok) {
      toast.error(res.error);
      setSubmitting(false);
      return;
    }
    toast.success(`${item.name} collected`);
    setOpen(false);
    setSubmitting(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={!canEdit} className="flex-1">
          Collect
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Collect {item.name}</DialogTitle>
          <DialogDescription>
            Record the guest handover. Identity details and signature are stored to prevent wrong-guest handover.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div>
            <Label>Guest name *</Label>
            <Input placeholder="Full name" {...register("guestName")} />
            {err(formState.errors.guestName?.message)}
          </div>
          <div>
            <Label>ID type *</Label>
            {/* eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form's watch is the intended controlled-Select pattern */}
            <Select value={watch("idType")} onValueChange={(v) => setValue("idType", v as CollectionForm["idType"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ID_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ID_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <IdScanner onResult={handleScan} />
          </div>
          <div>
            <Label>ID number *</Label>
            <Input placeholder="ID number as shown" {...register("idNumber")} />
            {err(formState.errors.idNumber?.message)}
          </div>
          <div>
            <Label>Contact number *</Label>
            <Input type="tel" placeholder="Phone / room" {...register("contact")} />
            {err(formState.errors.contact?.message)}
          </div>
          <div>
            <Label>Guest signature *</Label>
            <SignaturePadInput onChange={(svg) => setValue("signature", svg ?? "")} />
            {err(formState.errors.signature?.message)}
          </div>
          <DialogFooter>
            <SubmitButton submitting={submitting} label="Record collection" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- Discard ------------------------------- */

const discardFormSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required").max(2000),
  witnessName: z.string().trim().min(1, "Witness name is required").max(200),
  witnessSignature: z.string().min(1, "Witness signature is required"),
});
type DiscardForm = z.input<typeof discardFormSchema>;

export function DiscardDialog({ item, canEdit }: { item: ItemTarget; canEdit: boolean }) {
  const { router, open, setOpen, submitting, setSubmitting } = useDialogState();
  const form = useForm<DiscardForm>({
    resolver: zodResolver(discardFormSchema),
    defaultValues: { reason: "", witnessName: "", witnessSignature: "" },
  });
  const { register, handleSubmit, setValue, formState } = form;

  const onSubmit = async (values: DiscardForm) => {
    setSubmitting(true);
    const res = await discardItem(item.id, values);
    if (!res.ok) {
      toast.error(res.error);
      setSubmitting(false);
      return;
    }
    toast.success(`${item.name} marked as discarded`);
    setOpen(false);
    setSubmitting(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!canEdit} className="flex-1">
          Discard
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard {item.name}</DialogTitle>
          <DialogDescription>Record why the item is being discarded and who witnessed it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div>
            <Label>Reason *</Label>
            <Textarea rows={2} placeholder="Why is this being discarded?" {...register("reason")} />
            {err(formState.errors.reason?.message)}
          </div>
          <div>
            <Label>Witness name *</Label>
            <Input placeholder="Who witnessed the discard" {...register("witnessName")} />
            {err(formState.errors.witnessName?.message)}
          </div>
          <div>
            <Label>Witness signature *</Label>
            <SignaturePadInput onChange={(svg) => setValue("witnessSignature", svg ?? "")} />
            {err(formState.errors.witnessSignature?.message)}
          </div>
          <DialogFooter>
            <SubmitButton submitting={submitting} label="Confirm discard" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- Police handover --------------------------- */

const policeFormSchema = z.object({
  referenceNumber: z.string().trim().min(1, "Police reference is required").max(100),
  notes: z.string().trim().max(2000).optional(),
});
type PoliceForm = z.input<typeof policeFormSchema>;

export function PoliceDialog({ item, canEdit }: { item: ItemTarget; canEdit: boolean }) {
  const { router, open, setOpen, submitting, setSubmitting } = useDialogState();
  const form = useForm<PoliceForm>({
    resolver: zodResolver(policeFormSchema),
    defaultValues: { referenceNumber: "", notes: "" },
  });
  const { register, handleSubmit, formState } = form;

  const onSubmit = async (values: PoliceForm) => {
    setSubmitting(true);
    const res = await policeHandover(item.id, values);
    if (!res.ok) {
      toast.error(res.error);
      setSubmitting(false);
      return;
    }
    toast.success(`Handed to police (ref ${values.referenceNumber})`);
    setOpen(false);
    setSubmitting(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!canEdit} className="flex-1">
          Police
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hand {item.name} to Dubai Police</DialogTitle>
          <DialogDescription>
            Enter the unique reference from the police portal. Item photos are submitted separately.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div>
            <Label>Police reference *</Label>
            <Input placeholder="e.g. 2026-12345" {...register("referenceNumber")} />
            {err(formState.errors.referenceNumber?.message)}
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} {...register("notes")} />
          </div>
          <DialogFooter>
            <SubmitButton submitting={submitting} label="Record handover" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- Enquiry ------------------------------- */

const enquiryFormSchema = z.object({
  enquirerName: z.string().trim().min(1, "Enquirer name is required").max(200),
  enquirerContact: z.string().trim().min(1, "Contact is required").max(100),
  notes: z.string().trim().max(2000).optional(),
  itemId: z.string(),
});
type EnquiryForm = z.input<typeof enquiryFormSchema>;

export function EnquiryDialog({
  entryId,
  items,
  canEdit,
}: {
  entryId: string;
  items: ItemTarget[];
  canEdit: boolean;
}) {
  const { router, open, setOpen, submitting, setSubmitting } = useDialogState();
  const form = useForm<EnquiryForm>({
    resolver: zodResolver(enquiryFormSchema),
    defaultValues: { enquirerName: "", enquirerContact: "", notes: "", itemId: "" },
  });
  const { register, handleSubmit, setValue, formState, watch } = form;

  const onSubmit = async (values: EnquiryForm) => {
    setSubmitting(true);
    const res = await enquireEntry(entryId, { ...values, itemId: values.itemId || null });
    if (!res.ok) {
      toast.error(res.error);
      setSubmitting(false);
      return;
    }
    toast.success("Enquiry logged");
    setOpen(false);
    setSubmitting(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!canEdit}>
          Log enquiry
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log an enquiry</DialogTitle>
          <DialogDescription>Record who asked about this item and how to reach them.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div>
            <Label>Enquirer name *</Label>
            <Input placeholder="Full name" {...register("enquirerName")} />
            {err(formState.errors.enquirerName?.message)}
          </div>
          <div>
            <Label>Contact *</Label>
            <Input placeholder="Phone / email / room" {...register("enquirerContact")} />
            {err(formState.errors.enquirerContact?.message)}
          </div>
          <div>
            <Label>Item</Label>
            {/* eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form's watch is the intended controlled-Select pattern */}
            <Select value={watch("itemId")} onValueChange={(v) => setValue("itemId", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Whole entry" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Whole entry</SelectItem>
                {items.map((it) => (
                  <SelectItem key={it.id} value={it.id}>
                    {it.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} {...register("notes")} />
          </div>
          <DialogFooter>
            <SubmitButton submitting={submitting} label="Log enquiry" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
