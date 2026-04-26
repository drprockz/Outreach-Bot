-- Atomic migration: seed Org 1 + backfill + enforce NOT NULL
-- Owner email: darshanrajeshparmar@gmail.com (login email, NOT outreach inbox)

BEGIN;

-- Seed plans
INSERT INTO plans (id, name, price_inr, limits_json) VALUES
  (1, 'Trial',   0,     '{"leadsPerDay":34,"seats":1,"claudeDailySpendCapUsd":1,"geminiQueriesPerDay":150,"bulkRetryEnabled":false,"exportEnabled":false,"apiAccess":false}'::jsonb),
  (2, 'Starter', 2999,  '{"leadsPerDay":34,"seats":2,"claudeDailySpendCapUsd":3,"geminiQueriesPerDay":150,"bulkRetryEnabled":true,"exportEnabled":true,"apiAccess":false}'::jsonb),
  (3, 'Growth',  6999,  '{"leadsPerDay":68,"seats":5,"claudeDailySpendCapUsd":6,"geminiQueriesPerDay":300,"bulkRetryEnabled":true,"exportEnabled":true,"apiAccess":false}'::jsonb),
  (4, 'Agency',  14999, '{"leadsPerDay":-1,"seats":10,"claudeDailySpendCapUsd":12,"geminiQueriesPerDay":600,"bulkRetryEnabled":true,"exportEnabled":true,"apiAccess":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Reset plan id sequence past the seeded ids
SELECT setval('plans_id_seq', GREATEST((SELECT MAX(id) FROM plans), 4));

-- Seed Org 1
INSERT INTO orgs (id, name, slug, status, created_at)
  VALUES (1, 'Simple Inc', 'simpleinc', 'active', NOW())
  ON CONFLICT (id) DO NOTHING;
SELECT setval('orgs_id_seq', GREATEST((SELECT MAX(id) FROM orgs), 1));

-- Seed superadmin user with the user's login email
INSERT INTO users (id, email, is_superadmin, created_at)
  VALUES (1, 'darshanrajeshparmar@gmail.com', true, NOW())
  ON CONFLICT (id) DO NOTHING;
SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1));

-- Membership: user 1 is owner of org 1
INSERT INTO org_memberships (org_id, user_id, role)
  VALUES (1, 1, 'owner')
  ON CONFLICT (org_id, user_id) DO NOTHING;

-- Org 1 starts on Agency plan (superadmin override, no billing)
INSERT INTO org_subscriptions (org_id, plan_id, status)
  VALUES (1, 4, 'active')
  ON CONFLICT (org_id) DO NOTHING;

-- Backfill all 15 tenant tables with org_id = 1
UPDATE leads          SET org_id = 1 WHERE org_id IS NULL;
UPDATE emails         SET org_id = 1 WHERE org_id IS NULL;
UPDATE replies        SET org_id = 1 WHERE org_id IS NULL;
UPDATE bounces        SET org_id = 1 WHERE org_id IS NULL;
UPDATE cron_log       SET org_id = 1 WHERE org_id IS NULL;
UPDATE daily_metrics  SET org_id = 1 WHERE org_id IS NULL;
UPDATE error_log      SET org_id = 1 WHERE org_id IS NULL;
UPDATE sequence_state SET org_id = 1 WHERE org_id IS NULL;
UPDATE config         SET org_id = 1 WHERE org_id IS NULL;
UPDATE niches         SET org_id = 1 WHERE org_id IS NULL;
UPDATE offer          SET org_id = 1 WHERE org_id IS NULL;
UPDATE icp_profile    SET org_id = 1 WHERE org_id IS NULL;
UPDATE saved_views    SET org_id = 1 WHERE org_id IS NULL;
UPDATE lead_signals   SET org_id = 1 WHERE org_id IS NULL;
UPDATE reject_list    SET org_id = 1 WHERE org_id IS NULL;

-- Enforce NOT NULL on all 15 tenant tables
ALTER TABLE leads          ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE emails         ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE replies        ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE bounces        ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE cron_log       ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE daily_metrics  ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE error_log      ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE sequence_state ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE config         ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE niches         ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE offer          ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE icp_profile    ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE saved_views    ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE lead_signals   ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE reject_list    ALTER COLUMN org_id SET NOT NULL;

COMMIT;
