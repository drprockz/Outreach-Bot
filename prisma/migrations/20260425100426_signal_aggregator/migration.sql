-- AlterTable
ALTER TABLE "emails" ADD COLUMN     "hook_variant_id" TEXT,
ADD COLUMN     "signals_used_json" JSONB;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "company_linkedin_url" TEXT,
ADD COLUMN     "dm_linkedin_url" TEXT,
ADD COLUMN     "founder_linkedin_url" TEXT,
ADD COLUMN     "manual_hook_note" TEXT;

-- CreateTable
CREATE TABLE "lead_signals" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "signal_type" TEXT NOT NULL,
    "headline" TEXT,
    "url" TEXT,
    "payload_json" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL,
    "signal_date" TIMESTAMPTZ(6),
    "collected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_signals_lead_id_idx" ON "lead_signals"("lead_id");

-- CreateIndex
CREATE INDEX "lead_signals_lead_id_confidence_idx" ON "lead_signals"("lead_id", "confidence" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_lead_signals_dedup" ON "lead_signals"("lead_id", "source", "signal_type", "url");

-- AddForeignKey
ALTER TABLE "lead_signals" ADD CONSTRAINT "lead_signals_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
