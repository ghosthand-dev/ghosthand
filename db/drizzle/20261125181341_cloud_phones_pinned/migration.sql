-- Phones are pinned to one host forever; the R2 copies (version, saved_version, save_cursor) are gone.
ALTER TABLE "cloud_phone" ADD COLUMN "first_run_at" timestamp with time zone;--> statement-breakpoint
-- A phone that ran on its host (hashed once, or running now) has its VM there. A first start not yet
-- reported running stays unset, so it may still clone. A phone with no host had its only copy in
-- R2, which is dropped with this decision: it starts fresh from the template.
UPDATE "cloud_phone" SET "first_run_at" = "state_changed_at" WHERE "host_slug" IS NOT NULL AND ("version" > 0 OR "state" IN ('running', 'stopping'));--> statement-breakpoint
UPDATE "cloud_phone" SET "state" = 'stopped' WHERE "state" = 'stored';--> statement-breakpoint
ALTER TABLE "cloud_phone" ALTER COLUMN "state" SET DEFAULT 'stopped';--> statement-breakpoint
ALTER TABLE "cloud_phone" DROP COLUMN "version";--> statement-breakpoint
ALTER TABLE "cloud_phone" DROP COLUMN "saved_version";--> statement-breakpoint
ALTER TABLE "cloud_phone" DROP COLUMN "save_cursor";--> statement-breakpoint
ALTER TABLE "cloud_phone" DROP CONSTRAINT "cloud_phone_host_slug_cloud_host_slug_fkey", ADD CONSTRAINT "cloud_phone_host_slug_cloud_host_slug_fkey" FOREIGN KEY ("host_slug") REFERENCES "cloud_host"("slug") ON DELETE RESTRICT;
