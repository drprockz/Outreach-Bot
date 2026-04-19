-- CreateTable
CREATE TABLE "leads" (
    "id" SERIAL NOT NULL,
    "discovered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "business_name" TEXT,
    "website_url" TEXT,
    "category" TEXT,
    "city" TEXT,
    "country" TEXT DEFAULT 'IN',
    "search_query" TEXT,
    "tech_stack" JSONB,
    "website_problems" JSONB,
    "last_updated" TEXT,
    "has_ssl" BOOLEAN,
    "has_analytics" BOOLEAN,
    "owner_name" TEXT,
    "owner_role" TEXT,
    "business_signals" JSONB,
    "social_active" BOOLEAN,
    "website_quality_score" INTEGER,
    "judge_reason" TEXT,
    "judge_skip" BOOLEAN NOT NULL DEFAULT false,
    "icp_score" INTEGER,
    "icp_priority" TEXT,
    "icp_reason" TEXT,
    "icp_breakdown" JSONB,
    "icp_key_matches" JSONB,
    "icp_key_gaps" JSONB,
    "icp_disqualifiers" JSONB,
    "employees_estimate" TEXT,
    "business_stage" TEXT,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_confidence" TEXT,
    "contact_source" TEXT,
    "email_status" TEXT,
    "email_verified_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'discovered',
    "domain_last_contacted" TIMESTAMPTZ(6),
    "in_reject_list" BOOLEAN NOT NULL DEFAULT false,
    "gemini_tokens_used" INTEGER,
    "gemini_cost_usd" DECIMAL(10,6),
    "discovery_model" TEXT,
    "extraction_model" TEXT,
    "judge_model" TEXT,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emails" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER,
    "sequence_step" INTEGER NOT NULL DEFAULT 0,
    "inbox_used" TEXT,
    "from_domain" TEXT DEFAULT 'trysimpleinc.com',
    "from_name" TEXT,
    "subject" TEXT,
    "body" TEXT,
    "word_count" INTEGER,
    "hook" TEXT,
    "contains_link" BOOLEAN NOT NULL DEFAULT false,
    "is_html" BOOLEAN NOT NULL DEFAULT false,
    "is_plain_text" BOOLEAN NOT NULL DEFAULT true,
    "content_valid" BOOLEAN NOT NULL DEFAULT true,
    "validation_fail_reason" TEXT,
    "regenerated" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMPTZ(6),
    "smtp_response" TEXT,
    "smtp_code" INTEGER,
    "message_id" TEXT,
    "send_duration_ms" INTEGER,
    "in_reply_to" TEXT,
    "references_header" TEXT,
    "hook_model" TEXT,
    "body_model" TEXT,
    "hook_cost_usd" DECIMAL(10,6),
    "body_cost_usd" DECIMAL(10,6),
    "total_cost_usd" DECIMAL(10,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bounces" (
    "id" SERIAL NOT NULL,
    "email_id" INTEGER,
    "lead_id" INTEGER,
    "bounce_type" TEXT,
    "smtp_code" INTEGER,
    "smtp_message" TEXT,
    "bounced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retry_after" TIMESTAMPTZ(6),

    CONSTRAINT "bounces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replies" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER,
    "email_id" INTEGER,
    "inbox_received_at" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT,
    "raw_text" TEXT,
    "classification_model" TEXT,
    "classification_cost_usd" DECIMAL(10,6),
    "sentiment_score" INTEGER,
    "telegram_alerted" BOOLEAN NOT NULL DEFAULT false,
    "requeue_date" TIMESTAMPTZ(6),
    "actioned_at" TIMESTAMPTZ(6),
    "action_taken" TEXT,

    CONSTRAINT "replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reject_list" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "domain" TEXT,
    "reason" TEXT,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reject_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_log" (
    "id" SERIAL NOT NULL,
    "job_name" TEXT,
    "scheduled_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "status" TEXT,
    "error_message" TEXT,
    "records_processed" INTEGER,
    "records_skipped" INTEGER,
    "cost_usd" DECIMAL(10,6),
    "notes" TEXT,

    CONSTRAINT "cron_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_metrics" (
    "id" SERIAL NOT NULL,
    "date" TEXT NOT NULL,
    "leads_discovered" INTEGER NOT NULL DEFAULT 0,
    "leads_extracted" INTEGER NOT NULL DEFAULT 0,
    "leads_judge_passed" INTEGER NOT NULL DEFAULT 0,
    "leads_email_found" INTEGER NOT NULL DEFAULT 0,
    "leads_email_valid" INTEGER NOT NULL DEFAULT 0,
    "leads_icp_ab" INTEGER NOT NULL DEFAULT 0,
    "leads_ready" INTEGER NOT NULL DEFAULT 0,
    "leads_disqualified" INTEGER NOT NULL DEFAULT 0,
    "emails_attempted" INTEGER NOT NULL DEFAULT 0,
    "emails_sent" INTEGER NOT NULL DEFAULT 0,
    "emails_hard_bounced" INTEGER NOT NULL DEFAULT 0,
    "emails_soft_bounced" INTEGER NOT NULL DEFAULT 0,
    "emails_content_rejected" INTEGER NOT NULL DEFAULT 0,
    "sent_inbox_1" INTEGER NOT NULL DEFAULT 0,
    "sent_inbox_2" INTEGER NOT NULL DEFAULT 0,
    "replies_total" INTEGER NOT NULL DEFAULT 0,
    "replies_hot" INTEGER NOT NULL DEFAULT 0,
    "replies_schedule" INTEGER NOT NULL DEFAULT 0,
    "replies_soft_no" INTEGER NOT NULL DEFAULT 0,
    "replies_unsubscribe" INTEGER NOT NULL DEFAULT 0,
    "replies_ooo" INTEGER NOT NULL DEFAULT 0,
    "replies_other" INTEGER NOT NULL DEFAULT 0,
    "bounce_rate" DOUBLE PRECISION,
    "reply_rate" DOUBLE PRECISION,
    "unsubscribe_rate" DOUBLE PRECISION,
    "gemini_cost_usd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "sonnet_cost_usd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "haiku_cost_usd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "mev_cost_usd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "total_api_cost_usd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "total_api_cost_inr" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "domain_blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "blacklist_zones" JSONB,
    "mail_tester_score" DOUBLE PRECISION,
    "postmaster_reputation" TEXT,
    "icp_parse_errors" INTEGER NOT NULL DEFAULT 0,
    "followups_sent" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_log" (
    "id" SERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    "job_name" TEXT,
    "error_type" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "stack_trace" TEXT,
    "lead_id" INTEGER,
    "email_id" INTEGER,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "error_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_state" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "next_send_date" DATE,
    "last_sent_at" TIMESTAMPTZ(6),
    "last_message_id" TEXT,
    "last_subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "paused_reason" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sequence_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config" (
    "key" TEXT NOT NULL,
    "value" TEXT,

    CONSTRAINT "config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "niches" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "day_of_week" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "niches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icp_rules" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "icp_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "problem" TEXT,
    "outcome" TEXT,
    "category" TEXT,
    "use_cases" JSONB,
    "triggers" JSONB,
    "alternatives" JSONB,
    "differentiation" TEXT,
    "price_range" TEXT,
    "sales_cycle" TEXT,
    "criticality" TEXT,
    "inaction_cost" TEXT,
    "required_inputs" JSONB,
    "proof_points" JSONB,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icp_profile" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "industries" JSONB,
    "company_size" TEXT,
    "revenue_range" TEXT,
    "geography" JSONB,
    "stage" JSONB,
    "tech_stack" JSONB,
    "internal_capabilities" JSONB,
    "budget_range" TEXT,
    "problem_frequency" TEXT,
    "problem_cost" TEXT,
    "impacted_kpis" JSONB,
    "initiator_roles" JSONB,
    "decision_roles" JSONB,
    "objections" JSONB,
    "buying_process" TEXT,
    "intent_signals" JSONB,
    "current_tools" JSONB,
    "workarounds" JSONB,
    "frustrations" JSONB,
    "switching_barriers" JSONB,
    "hard_disqualifiers" JSONB,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "icp_profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_icp_priority_icp_score_idx" ON "leads"("icp_priority", "icp_score");

-- CreateIndex
CREATE INDEX "leads_contact_email_idx" ON "leads"("contact_email");

-- CreateIndex
CREATE INDEX "emails_lead_id_idx" ON "emails"("lead_id");

-- CreateIndex
CREATE INDEX "emails_sent_at_idx" ON "emails"("sent_at");

-- CreateIndex
CREATE INDEX "emails_status_idx" ON "emails"("status");

-- CreateIndex
CREATE INDEX "replies_lead_id_idx" ON "replies"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "reject_list_email_key" ON "reject_list"("email");

-- CreateIndex
CREATE INDEX "reject_list_email_idx" ON "reject_list"("email");

-- CreateIndex
CREATE INDEX "reject_list_domain_idx" ON "reject_list"("domain");

-- CreateIndex
CREATE INDEX "cron_log_job_name_scheduled_at_idx" ON "cron_log"("job_name", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "daily_metrics_date_key" ON "daily_metrics"("date");

-- CreateIndex
CREATE INDEX "daily_metrics_date_idx" ON "daily_metrics"("date");

-- CreateIndex
CREATE INDEX "error_log_source_occurred_at_idx" ON "error_log"("source", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_state_lead_id_key" ON "sequence_state"("lead_id");

-- AddForeignKey
ALTER TABLE "emails" ADD CONSTRAINT "emails_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bounces" ADD CONSTRAINT "bounces_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bounces" ADD CONSTRAINT "bounces_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replies" ADD CONSTRAINT "replies_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replies" ADD CONSTRAINT "replies_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_state" ADD CONSTRAINT "sequence_state_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
