export const ENTRY_STATUS_LABELS = {
  logged: "Logged",
  enquired: "Enquired",
  collected: "Collected",
  discarded: "Discarded",
  partially_collected: "Partially collected",
} as const;

export const ITEM_STATUS_LABELS = {
  logged: "Logged",
  collected: "Collected",
  discarded: "Discarded",
  handed_to_police: "Handed to police",
} as const;

export const STORAGE_LABELS = {
  lost_found_store: "Lost & Found store",
  security: "Security",
  office: "Office",
} as const;

export const ID_TYPE_LABELS = {
  emirates_id: "Emirates ID",
  passport: "Passport",
  drivers_licence: "Driver's licence",
  other: "Other",
} as const;

export const CATEGORY_LABELS = {
  general: "General",
  food: "Food",
  alcohol: "Alcohol",
  electronics: "Electronics",
  clothing: "Clothing",
  jewellery: "Jewellery",
  currency: "Currency",
  documents: "Documents",
  other: "Other",
} as const;
