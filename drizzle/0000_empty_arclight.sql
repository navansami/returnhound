CREATE TYPE "public"."draft_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."entry_status" AS ENUM('logged', 'enquired', 'collected', 'discarded', 'partially_collected');--> statement-breakpoint
CREATE TYPE "public"."id_type" AS ENUM('emirates_id', 'passport', 'drivers_licence', 'other');--> statement-breakpoint
CREATE TYPE "public"."item_category" AS ENUM('general', 'food', 'alcohol', 'electronics', 'clothing', 'jewellery', 'currency', 'documents', 'other');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('logged', 'collected', 'discarded', 'handed_to_police');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'editor', 'security', 'moderator');--> statement-breakpoint
CREATE TYPE "public"."storage_location" AS ENUM('lost_found_store', 'security', 'office');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"user_id" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"guest_name" text NOT NULL,
	"id_type" "id_type" NOT NULL,
	"id_number" text NOT NULL,
	"contact" text NOT NULL,
	"signature" text,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"collected_by_id" text
);
--> statement-breakpoint
CREATE TABLE "discard" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"witness_name" text NOT NULL,
	"witness_signature" text,
	"discarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discarded_by_id" text
);
--> statement-breakpoint
CREATE TABLE "draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_image_url" text,
	"form_image_public_id" text,
	"status" "draft_status" DEFAULT 'pending' NOT NULL,
	"parsed_data" jsonb,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enquiry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"item_id" uuid,
	"enquirer_name" text NOT NULL,
	"enquirer_contact" text NOT NULL,
	"notes" text,
	"enquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enquired_by_id" text
);
--> statement-breakpoint
CREATE TABLE "entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rs_number" text NOT NULL,
	"status" "entry_status" DEFAULT 'logged' NOT NULL,
	"found_at" timestamp with time zone NOT NULL,
	"found_location" text NOT NULL,
	"finder_name" text NOT NULL,
	"finder_department" text,
	"finder_employee_id" text,
	"received_at" timestamp with time zone,
	"agent_user_id" text,
	"agent_name" text,
	"agent_signature" text,
	"storage_location" "storage_location" DEFAULT 'lost_found_store' NOT NULL,
	"storage_detail" text,
	"is_valuable" boolean DEFAULT false NOT NULL,
	"comments" text,
	"form_image_url" text,
	"form_image_public_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	CONSTRAINT "entry_rs_number_unique" UNIQUE("rs_number")
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "item_category" DEFAULT 'general' NOT NULL,
	"image_url" text,
	"image_public_id" text,
	"status" "item_status" DEFAULT 'logged' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "police_handover" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"reference_number" text NOT NULL,
	"notes" text,
	"handed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handed_by_id" text,
	CONSTRAINT "police_handover_reference_number_unique" UNIQUE("reference_number")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "role" DEFAULT 'moderator' NOT NULL,
	"employee_id" text,
	"department" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_collected_by_id_user_id_fk" FOREIGN KEY ("collected_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discard" ADD CONSTRAINT "discard_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discard" ADD CONSTRAINT "discard_discarded_by_id_user_id_fk" FOREIGN KEY ("discarded_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft" ADD CONSTRAINT "draft_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry" ADD CONSTRAINT "enquiry_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry" ADD CONSTRAINT "enquiry_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry" ADD CONSTRAINT "enquiry_enquired_by_id_user_id_fk" FOREIGN KEY ("enquired_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_agent_user_id_user_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "police_handover" ADD CONSTRAINT "police_handover_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "police_handover" ADD CONSTRAINT "police_handover_handed_by_id_user_id_fk" FOREIGN KEY ("handed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting" ADD CONSTRAINT "setting_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;