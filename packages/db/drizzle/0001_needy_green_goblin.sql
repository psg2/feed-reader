CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"prompt_version" text NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"site_url" text,
	"category" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"full_page" boolean DEFAULT false NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feeds_userId_url_unique" UNIQUE("user_id","url")
);
--> statement-breakpoint
CREATE TABLE "item_tags" (
	"item_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "item_tags_itemId_tag_unique" UNIQUE("item_id","tag")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_id" uuid NOT NULL,
	"guid" text NOT NULL,
	"link" text,
	"title" text NOT NULL,
	"author" text,
	"published_at" timestamp with time zone,
	"content_html" text,
	"content_text" text,
	"read_at" timestamp with time zone,
	"starred" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_feedId_guid_unique" UNIQUE("feed_id","guid")
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_tags_tag_idx" ON "item_tags" USING btree ("tag");--> statement-breakpoint
CREATE INDEX "items_published_at_idx" ON "items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "items_read_at_idx" ON "items" USING btree ("read_at");