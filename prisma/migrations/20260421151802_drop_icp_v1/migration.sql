/*
  Warnings:

  - You are about to drop the column `icp_priority` on the `leads` table. All the data in the column will be lost.
  - You are about to drop the `icp_rules` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "leads_icp_priority_icp_score_idx";

-- AlterTable
ALTER TABLE "leads" DROP COLUMN "icp_priority";

-- DropTable
DROP TABLE "icp_rules";

-- CreateIndex
CREATE INDEX "leads_icp_score_idx" ON "leads"("icp_score");
