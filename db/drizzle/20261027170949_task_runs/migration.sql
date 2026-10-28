CREATE TABLE "task_run" (
	"task_run_id" text PRIMARY KEY,
	"org_id" text NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "task_run_org_id_created_at_idx" ON "task_run" ("org_id","created_at");--> statement-breakpoint
ALTER TABLE "task_run" ADD CONSTRAINT "task_run_org_id_org_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("org_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_run" ADD CONSTRAINT "task_run_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;