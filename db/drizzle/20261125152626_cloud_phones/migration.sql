CREATE TABLE "cloud_host" (
	"slug" text PRIMARY KEY,
	"environment" text NOT NULL,
	"address" text NOT NULL,
	"slots" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cloud_lease" (
	"cloud_lease_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cloud_lease_cloud_lease_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cloud_phone_id" text NOT NULL,
	"label" text,
	"reason" text NOT NULL,
	"idle_timeout_s" integer NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_command" text,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cloud_phone" (
	"cloud_phone_id" text PRIMARY KEY,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"subscription_id" text UNIQUE,
	"template" text NOT NULL,
	"state" text DEFAULT 'stored' NOT NULL,
	"host_slug" text,
	"version" integer DEFAULT 0 NOT NULL,
	"saved_version" integer DEFAULT 0 NOT NULL,
	"save_cursor" integer DEFAULT 0 NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "kind" text DEFAULT 'pro' NOT NULL;--> statement-breakpoint
CREATE INDEX "cloud_lease_cloud_phone_id_idx" ON "cloud_lease" ("cloud_phone_id");--> statement-breakpoint
CREATE INDEX "cloud_phone_org_id_idx" ON "cloud_phone" ("org_id");--> statement-breakpoint
CREATE INDEX "cloud_phone_host_slug_idx" ON "cloud_phone" ("host_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "cloud_phone_org_unpaid_unique" ON "cloud_phone" ("org_id") WHERE "subscription_id" is null;--> statement-breakpoint
ALTER TABLE "cloud_lease" ADD CONSTRAINT "cloud_lease_cloud_phone_id_cloud_phone_cloud_phone_id_fkey" FOREIGN KEY ("cloud_phone_id") REFERENCES "cloud_phone"("cloud_phone_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cloud_phone" ADD CONSTRAINT "cloud_phone_org_id_org_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("org_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cloud_phone" ADD CONSTRAINT "cloud_phone_subscription_id_subscription_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscription"("subscription_id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cloud_phone" ADD CONSTRAINT "cloud_phone_host_slug_cloud_host_slug_fkey" FOREIGN KEY ("host_slug") REFERENCES "cloud_host"("slug") ON DELETE SET NULL;