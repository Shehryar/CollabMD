ALTER TABLE folders ADD COLUMN position integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE documents ADD COLUMN position integer NOT NULL DEFAULT 0;
