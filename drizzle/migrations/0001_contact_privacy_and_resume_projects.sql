ALTER TABLE `resume_entries` ADD `project_id` text REFERENCES projects(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `resume_profile` ADD `email_privacy` text DEFAULT 'reveal' NOT NULL;--> statement-breakpoint
ALTER TABLE `resume_profile` ADD `phone_privacy` text DEFAULT 'reveal' NOT NULL;--> statement-breakpoint
ALTER TABLE `site_config` ADD `email_privacy` text DEFAULT 'reveal' NOT NULL;