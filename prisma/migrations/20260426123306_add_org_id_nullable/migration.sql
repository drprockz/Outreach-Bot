-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'admin');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('trial', 'active', 'locked', 'suspended');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trial', 'active', 'grace', 'locked', 'cancelled');

-- AlterTable
ALTER TABLE "bounces" ADD COLUMN     "org_id" INTEGER;

-- AlterTable
ALTER TABLE "config" ADD COLUMN     "org_id" INTEGER;

-- AlterTable
ALTER TABLE "cron_log" ADD COLUMN     "org_id" INTEGER;

-- AlterTable
ALTER TABLE "daily_metrics" ADD COLUMN     "org_id" INTEGER;

-- AlterTable
ALTER TABLE "emails" ADD COLUMN     "org_id" INTEGER;

-- AlterTable
ALTER TABLE "error_log" ADD COLUMN     "org_id" INTEGER;

-- AlterTable
ALTER TABLE "icp_profile" ADD COLUMN     "org_id" INTEGER;

-- AlterTable
ALTER TABLE "lead_signals" ADD COLUMN     "org_id" INTEGER;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "org_id" INTEGER;

-- AlterTable
ALTER TABLE "niches" ADD COLUMN     "org_id" INTEGER;

-- AlterTable
ALTER TABLE "offer" ADD COLUMN     "org_id" INTEGER;

-- AlterTable
ALTER TABLE "reject_list" ADD COLUMN     "org_id" INTEGER;

-- AlterTable
ALTER TABLE "replies" ADD COLUMN     "org_id" INTEGER;

-- AlterTable
ALTER TABLE "saved_views" ADD COLUMN     "org_id" INTEGER;

-- AlterTable
ALTER TABLE "sequence_state" ADD COLUMN     "org_id" INTEGER;

-- CreateTable
CREATE TABLE "orgs" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'trial',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orgs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "google_id" TEXT,
    "is_superadmin" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_memberships" (
    "id" SERIAL NOT NULL,
    "org_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" "Role" NOT NULL,

    CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "otp_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "price_inr" INTEGER NOT NULL,
    "limits_json" JSONB NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_subscriptions" (
    "id" SERIAL NOT NULL,
    "org_id" INTEGER NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'trial',
    "razorpay_sub_id" TEXT,
    "razorpay_customer_id" TEXT,
    "trial_ends_at" TIMESTAMPTZ(6),
    "current_period_end" TIMESTAMPTZ(6),
    "grace_ends_at" TIMESTAMPTZ(6),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "org_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "razorpay_webhook_events" (
    "id" SERIAL NOT NULL,
    "razorpay_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "org_sub_id" INTEGER NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "razorpay_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" INTEGER NOT NULL,
    "target_org_id" INTEGER,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orgs_slug_key" ON "orgs"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_memberships_org_id_user_id_key" ON "org_memberships"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "otp_tokens_user_id_used_expires_at_idx" ON "otp_tokens"("user_id", "used", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "org_subscriptions_org_id_key" ON "org_subscriptions"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "razorpay_webhook_events_razorpay_event_id_key" ON "razorpay_webhook_events"("razorpay_event_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log"("actor_id");

-- CreateIndex
CREATE INDEX "audit_log_target_org_id_idx" ON "audit_log"("target_org_id");

-- CreateIndex
CREATE INDEX "bounces_org_id_idx" ON "bounces"("org_id");

-- CreateIndex
CREATE INDEX "config_org_id_idx" ON "config"("org_id");

-- CreateIndex
CREATE INDEX "cron_log_org_id_idx" ON "cron_log"("org_id");

-- CreateIndex
CREATE INDEX "daily_metrics_org_id_idx" ON "daily_metrics"("org_id");

-- CreateIndex
CREATE INDEX "emails_org_id_idx" ON "emails"("org_id");

-- CreateIndex
CREATE INDEX "error_log_org_id_idx" ON "error_log"("org_id");

-- CreateIndex
CREATE INDEX "icp_profile_org_id_idx" ON "icp_profile"("org_id");

-- CreateIndex
CREATE INDEX "lead_signals_org_id_idx" ON "lead_signals"("org_id");

-- CreateIndex
CREATE INDEX "leads_org_id_idx" ON "leads"("org_id");

-- CreateIndex
CREATE INDEX "niches_org_id_idx" ON "niches"("org_id");

-- CreateIndex
CREATE INDEX "offer_org_id_idx" ON "offer"("org_id");

-- CreateIndex
CREATE INDEX "reject_list_org_id_idx" ON "reject_list"("org_id");

-- CreateIndex
CREATE INDEX "replies_org_id_idx" ON "replies"("org_id");

-- CreateIndex
CREATE INDEX "saved_views_org_id_idx" ON "saved_views"("org_id");

-- CreateIndex
CREATE INDEX "sequence_state_org_id_idx" ON "sequence_state"("org_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emails" ADD CONSTRAINT "emails_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bounces" ADD CONSTRAINT "bounces_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replies" ADD CONSTRAINT "replies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reject_list" ADD CONSTRAINT "reject_list_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cron_log" ADD CONSTRAINT "cron_log_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_log" ADD CONSTRAINT "error_log_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_state" ADD CONSTRAINT "sequence_state_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config" ADD CONSTRAINT "config_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "niches" ADD CONSTRAINT "niches_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer" ADD CONSTRAINT "offer_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icp_profile" ADD CONSTRAINT "icp_profile_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_signals" ADD CONSTRAINT "lead_signals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_tokens" ADD CONSTRAINT "otp_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "razorpay_webhook_events" ADD CONSTRAINT "razorpay_webhook_events_org_sub_id_fkey" FOREIGN KEY ("org_sub_id") REFERENCES "org_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
