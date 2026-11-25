CREATE TABLE "cloud_phone" (
	"cloud_phone_id" text PRIMARY KEY,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"subscription_id" text UNIQUE,
	"status" text DEFAULT 'pending' NOT NULL,
	"template" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "kind" text DEFAULT 'pro' NOT NULL;--> statement-breakpoint
CREATE INDEX "cloud_phone_org_id_idx" ON "cloud_phone" ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cloud_phone_org_unpaid_unique" ON "cloud_phone" ("org_id") WHERE "status" = 'pending' and "subscription_id" is null;--> statement-breakpoint
ALTER TABLE "cloud_phone" ADD CONSTRAINT "cloud_phone_org_id_org_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("org_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cloud_phone" ADD CONSTRAINT "cloud_phone_subscription_id_subscription_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscription"("subscription_id") ON DELETE SET NULL;