CREATE TYPE "org_device_kind" AS ENUM('phone', 'mac');--> statement-breakpoint
CREATE TABLE "org_device" (
	"org_device_id" text PRIMARY KEY,
	"org_id" text NOT NULL,
	"kind" "org_device_kind" NOT NULL,
	"device_hash" text NOT NULL,
	"name" text NOT NULL,
	"slot" integer NOT NULL,
	"bound_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_access" (
	"org_id" text PRIMARY KEY,
	"github_user_id" bigint NOT NULL,
	"github_login" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "org_device_org_id_idx" ON "org_device" ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_device_org_kind_hash_unique" ON "org_device" ("org_id","kind","device_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "org_device_org_kind_slot_unique" ON "org_device" ("org_id","kind","slot");--> statement-breakpoint
ALTER TABLE "org_device" ADD CONSTRAINT "org_device_org_id_org_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("org_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_access" ADD CONSTRAINT "source_access_org_id_org_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("org_id") ON DELETE CASCADE;