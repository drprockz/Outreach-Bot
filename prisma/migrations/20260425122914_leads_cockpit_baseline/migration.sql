-- CreateTable
CREATE TABLE "saved_views" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "filters_json" JSONB NOT NULL,
    "sort" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_leads_status_icp_score" ON "leads"("status", "icp_score" DESC);

-- CreateIndex
CREATE INDEX "idx_leads_domain_last_contacted" ON "leads"("domain_last_contacted" DESC);
