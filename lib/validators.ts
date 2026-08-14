import { z } from "zod";

import { toDatetimeLocal } from "@/lib/dates";

export const STORAGE_LOCATIONS = ["lost_found_store", "security", "office"] as const;
export const CATEGORIES = [
  "general",
  "food",
  "alcohol",
  "electronics",
  "clothing",
  "jewellery",
  "currency",
  "documents",
  "other",
] as const;
export const ITEM_STATUSES = ["logged", "collected", "discarded", "handed_to_police"] as const;
export const ID_TYPES = ["emirates_id", "passport", "drivers_licence", "other"] as const;

export const itemInputSchema = z.object({
  /** Present when editing an existing item; omitted for new items. */
  id: z.string().optional(),
  name: z.string().trim().min(1, "Item name is required").max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  category: z.enum(CATEGORIES).default("general"),
  imageUrl: z.string().url().optional().nullable(),
  imagePublicId: z.string().max(300).optional().nullable(),
});

export const entryInputSchema = z.object({
  foundAt: z.coerce.date(),
  foundLocation: z.string().trim().min(1, "Found location is required").max(300),
  finderName: z.string().trim().min(1, "Finder name is required").max(200),
  finderDepartment: z.string().trim().max(200).optional().nullable(),
  finderEmployeeId: z.string().trim().max(100).optional().nullable(),
  receivedAt: z.coerce.date().optional().nullable(),
  agentName: z.string().trim().max(200).optional().nullable(),
  /** Compact SVG from the signature pad. */
  agentSignature: z.string().max(20000).optional().nullable(),
  storageLocation: z.enum(STORAGE_LOCATIONS).default("lost_found_store"),
  storageDetail: z.string().trim().max(300).optional().nullable(),
  isValuable: z.boolean().default(false),
  comments: z.string().trim().max(4000).optional().nullable(),
  formImageUrl: z.string().url().optional().nullable(),
  formImagePublicId: z.string().max(300).optional().nullable(),
  items: z.array(itemInputSchema).min(1, "Add at least one item").max(20, "Maximum 20 items per form"),
});

export type EntryInput = z.infer<typeof entryInputSchema>;
export type ItemInput = z.infer<typeof itemInputSchema>;

/* ------------------------------ Lifecycle actions ----------------------------- */

export const enquirySchema = z.object({
  enquirerName: z.string().trim().min(1, "Enquirer name is required").max(200),
  enquirerContact: z.string().trim().min(1, "Contact number is required").max(100),
  notes: z.string().trim().max(2000).optional().nullable(),
  /** Optional — which item within the entry was enquired about. */
  itemId: z.string().optional().nullable(),
});

export const collectionSchema = z.object({
  guestName: z.string().trim().min(1, "Guest name is required").max(200),
  idType: z.enum(ID_TYPES),
  idNumber: z.string().trim().min(1, "ID number is required").max(100),
  contact: z.string().trim().min(1, "Contact number is required").max(100),
  /** Guest signature — critical to avoid wrong-guest handover. */
  signature: z.string().min(1, "Guest signature is required"),
});

export const discardSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required").max(2000),
  witnessName: z.string().trim().min(1, "Witness name is required").max(200),
  witnessSignature: z.string().min(1, "Witness signature is required"),
});

export const policeSchema = z.object({
  referenceNumber: z.string().trim().min(1, "Police reference is required").max(100),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/* --------------------------------- Import --------------------------------- */

/**
 * Payload for the CSV import. The client parses + groups the file and sends
 * canonical enums — the server only ever sees validated data.
 */
export const importItemSchema = z.object({
  name: z.string().trim().min(1, "Item name is required").max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  category: z.enum(CATEGORIES).default("general"),
  /** Carried over from the legacy sheet. No lifecycle record is created. */
  status: z.enum(ITEM_STATUSES).default("logged"),
});

export const importEntrySchema = z.object({
  /** Present only when the sheet carried RS numbers; otherwise auto-allocated. */
  rsNumber: z
    .string()
    .trim()
    .regex(/^RS\d{3,}$/i, "RS numbers must look like RS0001")
    .optional()
    .nullable(),
  foundAt: z.coerce.date(),
  foundLocation: z.string().trim().min(1, "Found location is required").max(300),
  finderName: z.string().trim().min(1, "Finder name is required").max(200),
  finderDepartment: z.string().trim().max(200).optional().nullable(),
  finderEmployeeId: z.string().trim().max(100).optional().nullable(),
  agentName: z.string().trim().max(200).optional().nullable(),
  storageLocation: z.enum(STORAGE_LOCATIONS).default("lost_found_store"),
  storageDetail: z.string().trim().max(300).optional().nullable(),
  isValuable: z.boolean().default(false),
  comments: z.string().trim().max(4000).optional().nullable(),
  items: z
    .array(importItemSchema)
    .min(1, "Each entry needs at least one item")
    .max(20, "Maximum 20 items per entry"),
});

export const importPayloadSchema = z.object({
  /** Original filename — recorded in the audit trail. */
  sourceFile: z.string().trim().min(1).max(300),
  /** Optional — continue auto-allocated numbering from a specific value. */
  startRsAt: z.number().int().positive().optional().nullable(),
  entries: z
    .array(importEntrySchema)
    .min(1, "Nothing to import")
    .max(5000, "Split files larger than 5000 entries"),
});

/* ------------------------------ Form OCR (Gemini) ------------------------------ */

/**
 * What the vision model is asked to extract from a photographed paper RS form.
 * Agent fields are deliberately absent — those belong to the signed-in agent,
 * not the paper. `isValuable` is omitted too: it auto-derives from
 * `storageLocation === "security"` when the entry is created.
 *
 * All fields normalize to `string | null` (blank/illegible → null, never a guess).
 */
export const formParseSchema = z
  .object({
    /** Legible date/time the item was found, ISO-8601-ish. */
    foundAt: z.string().trim().max(64).optional().nullable().transform((v) => v || null),
    foundLocation: z.string().trim().max(300).optional().nullable().transform((v) => v || null),
    finderName: z.string().trim().max(200).optional().nullable().transform((v) => v || null),
    finderDepartment: z.string().trim().max(200).optional().nullable().transform((v) => v || null),
    finderEmployeeId: z.string().trim().max(100).optional().nullable().transform((v) => v || null),
    storageLocation: z.enum(STORAGE_LOCATIONS).optional().nullable().transform((v) => v ?? null).catch(null),
    storageDetail: z.string().trim().max(300).optional().nullable().transform((v) => v || null),
    comments: z.string().trim().max(4000).optional().nullable().transform((v) => v || null),
    items: z
      .array(
        z.object({
          name: z.string().trim().max(200),
          description: z.string().trim().max(2000).optional().nullable().transform((v) => v || null),
          category: z.enum(CATEGORIES).default("general").catch("general"),
        }),
      )
      .max(20)
      .optional()
      .default([])
      .transform((items) => items.filter((it) => it.name.trim() !== "")),
  });

export type FormParse = z.infer<typeof formParseSchema>;

/** The `values` shape `EntryForm` expects (client formSchema in entry-form.tsx). */
export type EntryFormValues = {
  foundAt: string;
  receivedAt: string;
  foundLocation: string;
  finderName: string;
  finderDepartment: string;
  finderEmployeeId: string;
  agentName: string;
  storageLocation: (typeof STORAGE_LOCATIONS)[number];
  storageDetail: string;
  isValuable: boolean;
  comments: string;
  items: {
    id?: string;
    name: string;
    description: string;
    category: (typeof CATEGORIES)[number];
    imageUrl: string | null;
    imagePublicId: string | null;
  }[];
};

/**
 * Map OCR output into `EntryForm`'s initial values. Blanks fall back to
 * sensible defaults (found time = now, one empty item row) so the form always
 * satisfies its own validation before the agent edits anything.
 */
export function parsedToInitial(
  parsed: FormParse | null,
  defaults: { foundAt: string; receivedAt: string; agentName: string },
): EntryFormValues {
  const foundDate = parsed?.foundAt ? new Date(parsed.foundAt) : null;
  const items = (parsed?.items ?? []).map((it) => ({
    name: it.name,
    description: it.description ?? "",
    category: it.category,
    imageUrl: null,
    imagePublicId: null,
  }));

  return {
    foundAt:
      foundDate && !Number.isNaN(foundDate.getTime()) ? toDatetimeLocal(foundDate) : defaults.foundAt,
    receivedAt: defaults.receivedAt,
    foundLocation: parsed?.foundLocation ?? "",
    finderName: parsed?.finderName ?? "",
    finderDepartment: parsed?.finderDepartment ?? "",
    finderEmployeeId: parsed?.finderEmployeeId ?? "",
    agentName: defaults.agentName,
    storageLocation: parsed?.storageLocation ?? "lost_found_store",
    storageDetail: parsed?.storageDetail ?? "",
    isValuable: parsed?.storageLocation === "security",
    comments: parsed?.comments ?? "",
    items:
      items.length > 0
        ? items
        : [{ name: "", description: "", category: "general", imageUrl: null, imagePublicId: null }],
  };
}

/** First zod error message for display in a toast/alert. */
export function firstError(result: { error: { issues: { message: string }[] } }): string {
  return result.error.issues[0]?.message ?? "Invalid input.";
}
