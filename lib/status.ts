import type { itemStatusEnum, entryStatusEnum } from "@/lib/db/schema";

export type ItemStatus = (typeof itemStatusEnum)["enumValues"][number];
export type EntryStatus = (typeof entryStatusEnum)["enumValues"][number];

/**
 * Roll the entry status up from its items' lifecycle.
 *
 * Precedence: everything collected → collected; some collected → partially
 * collected; nothing active (all discarded / handed to police) → discarded;
 * otherwise enquiries present → enquired; else → logged.
 */
export function computeEntryStatus(items: ItemStatus[], hasEnquiry: boolean): EntryStatus {
  if (items.length === 0) return "logged";

  const collected = items.filter((s) => s === "collected").length;
  const active = items.filter((s) => s === "logged").length;

  if (collected === items.length) return "collected";
  if (collected > 0) return "partially_collected";
  if (active === 0) return "discarded"; // nothing collected, nothing left active
  if (hasEnquiry) return "enquired";
  return "logged";
}
