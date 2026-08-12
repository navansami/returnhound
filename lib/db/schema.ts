import { relations } from "drizzle-orm";
import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/* ---------------------------------- Enums ---------------------------------- */

export const roleEnum = pgEnum("role", [
  "admin",
  "editor",
  "security",
  "moderator",
]);

/** Entry-level status — the five values used in the legacy Excel sheet. */
export const entryStatusEnum = pgEnum("entry_status", [
  "logged",
  "enquired",
  "collected",
  "discarded",
  "partially_collected",
]);

/** Item-level lifecycle. Rolled up into the entry status. */
export const itemStatusEnum = pgEnum("item_status", [
  "logged",
  "collected",
  "discarded",
  "handed_to_police",
]);

export const storageLocationEnum = pgEnum("storage_location", [
  "lost_found_store",
  "security",
  "office",
]);

export const itemCategoryEnum = pgEnum("item_category", [
  "general",
  "food",
  "alcohol",
  "electronics",
  "clothing",
  "jewellery",
  "currency",
  "documents",
  "other",
]);

export const idTypeEnum = pgEnum("id_type", [
  "emirates_id",
  "passport",
  "drivers_licence",
  "other",
]);

export const draftStatusEnum = pgEnum("draft_status", [
  "pending",
  "approved",
  "rejected",
]);

/* ------------------------------- Auth tables -------------------------------- */
/**
 * Column names are snake_case and table names singular to match Better Auth's
 * Drizzle adapter conventions. The custom fields on `user` (role, employeeId,
 * department) are declared in the `additionalFields` config in lib/auth.ts.
 */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // Custom additional fields
  role: roleEnum("role").notNull().default("moderator"),
  employeeId: text("employee_id"),
  department: text("department"),
  /** Disabled by an admin — cannot sign in. */
  disabled: boolean("disabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------ Domain tables ------------------------------- */

/** One RS-numbered log — corresponds to a single paper form. */
export const entry = pgTable("entry", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Unique reference, e.g. RS0001. */
  rsNumber: text("rs_number").notNull().unique(),
  /** Computed rollup from items + enquiries; kept in sync on every mutation. */
  status: entryStatusEnum("status").notNull().default("logged"),
  foundAt: timestamp("found_at", { withTimezone: true }).notNull(),
  foundLocation: text("found_location").notNull(),
  finderName: text("finder_name").notNull(),
  finderDepartment: text("finder_department"),
  finderEmployeeId: text("finder_employee_id"),
  /** Agent (Lost & Found) sign-off on receipt. */
  receivedAt: timestamp("received_at", { withTimezone: true }),
  agentUserId: text("agent_user_id").references(() => user.id),
  agentName: text("agent_name"),
  agentSignature: text("agent_signature"), // compact SVG
  storageLocation: storageLocationEnum("storage_location")
    .notNull()
    .default("lost_found_store"),
  /** Breakdown of the storage location, e.g. cupboard / shelf / drawer. */
  storageDetail: text("storage_detail"),
  /** Anything handed to Security counts as valuable. */
  isValuable: boolean("is_valuable").notNull().default(false),
  comments: text("comments"),
  /** Photo of the paper form. */
  formImageUrl: text("form_image_url"),
  formImagePublicId: text("form_image_public_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdById: text("created_by_id").references(() => user.id),
  updatedById: text("updated_by_id").references(() => user.id),
});

/** One entry can hold 1–20 items, each with its own photo and lifecycle. */
export const item = pgTable("item", {
  id: uuid("id").defaultRandom().primaryKey(),
  entryId: uuid("entry_id")
    .notNull()
    .references(() => entry.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  category: itemCategoryEnum("category").notNull().default("general"),
  imageUrl: text("image_url"),
  imagePublicId: text("image_public_id"),
  status: itemStatusEnum("status").notNull().default("logged"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Log of a guest (or anyone) enquiring about an entry/item. */
export const enquiry = pgTable("enquiry", {
  id: uuid("id").defaultRandom().primaryKey(),
  entryId: uuid("entry_id")
    .notNull()
    .references(() => entry.id, { onDelete: "cascade" }),
  /** Optional — which item within the entry was enquired about. */
  itemId: uuid("item_id").references(() => item.id, { onDelete: "set null" }),
  enquirerName: text("enquirer_name").notNull(),
  enquirerContact: text("enquirer_contact").notNull(),
  notes: text("notes"),
  enquiredAt: timestamp("enquired_at", { withTimezone: true }).notNull().defaultNow(),
  enquiredById: text("enquired_by_id").references(() => user.id),
});

/** Guest handover — verification details + signature. One per collected item. */
export const collection = pgTable("collection", {
  id: uuid("id").defaultRandom().primaryKey(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => item.id, { onDelete: "cascade" }),
  guestName: text("guest_name").notNull(),
  idType: idTypeEnum("id_type").notNull(),
  idNumber: text("id_number").notNull(),
  contact: text("contact").notNull(),
  signature: text("signature"), // compact SVG
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  collectedById: text("collected_by_id").references(() => user.id),
});

/** Item discard — who authorised/witnessed it and why. */
export const discard = pgTable("discard", {
  id: uuid("id").defaultRandom().primaryKey(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => item.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  witnessName: text("witness_name").notNull(),
  witnessSignature: text("witness_signature"), // compact SVG
  discardedAt: timestamp("discarded_at", { withTimezone: true }).notNull().defaultNow(),
  discardedById: text("discarded_by_id").references(() => user.id),
});

/** Dubai Police handover — one reference per logged item on their portal. */
export const policeHandover = pgTable("police_handover", {
  id: uuid("id").defaultRandom().primaryKey(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => item.id, { onDelete: "cascade" }),
  referenceNumber: text("reference_number").notNull().unique(),
  notes: text("notes"),
  handedAt: timestamp("handed_at", { withTimezone: true }).notNull().defaultNow(),
  handedById: text("handed_by_id").references(() => user.id),
});

/** Immutable audit trail — every mutation writes a row here. */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  entityType: text("entity_type").notNull(), // entry | item | collection | discard | police_handover | enquiry | user | draft | setting
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(), // create | update | status_change | delete | collect | discard | police | enquire | ...
  userId: text("user_id").references(() => user.id),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Pending paper-form photo awaiting manual entry (OCR-ready in a later phase). */
export const draft = pgTable("draft", {
  id: uuid("id").defaultRandom().primaryKey(),
  formImageUrl: text("form_image_url"),
  formImagePublicId: text("form_image_public_id"),
  status: draftStatusEnum("status").notNull().default("pending"),
  /** Reserved for form OCR in a later phase. */
  parsedData: jsonb("parsed_data"),
  createdById: text("created_by_id").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Admin-configurable key/value settings (RS counter, report rules, ...). */
export const setting = pgTable("setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedById: text("updated_by_id").references(() => user.id),
});

/* -------------------------------- Relations --------------------------------- */

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  entries: many(entry),
}));

export const entryRelations = relations(entry, ({ many, one }) => ({
  items: many(item),
  enquiries: many(enquiry),
  createdBy: one(user, { fields: [entry.createdById], references: [user.id] }),
  updatedBy: one(user, { fields: [entry.updatedById], references: [user.id] }),
  agent: one(user, { fields: [entry.agentUserId], references: [user.id] }),
}));

export const itemRelations = relations(item, ({ one, many }) => ({
  entry: one(entry, { fields: [item.entryId], references: [entry.id] }),
  collections: many(collection),
  discards: many(discard),
  policeHandovers: many(policeHandover),
  enquiries: many(enquiry),
}));

export const collectionRelations = relations(collection, ({ one }) => ({
  item: one(item, { fields: [collection.itemId], references: [item.id] }),
}));

export const discardRelations = relations(discard, ({ one }) => ({
  item: one(item, { fields: [discard.itemId], references: [item.id] }),
}));

export const policeHandoverRelations = relations(policeHandover, ({ one }) => ({
  item: one(item, { fields: [policeHandover.itemId], references: [item.id] }),
}));

export const enquiryRelations = relations(enquiry, ({ one }) => ({
  entry: one(entry, { fields: [enquiry.entryId], references: [entry.id] }),
  item: one(item, { fields: [enquiry.itemId], references: [item.id] }),
}));
