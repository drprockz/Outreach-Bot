-- Set DEFAULT 1 on all 15 tenant tables' org_id columns.
-- This keeps the legacy single-tenant JS engines working: their INSERT statements
-- don't include org_id, and without a DEFAULT they would fail with NOT NULL violations
-- now that org_id is required.
--
-- Once all engines are migrated to the new TypeScript workers (Phase 1.5), this
-- DEFAULT can be dropped and every insert must explicitly set org_id.

ALTER TABLE leads          ALTER COLUMN org_id SET DEFAULT 1;
ALTER TABLE emails         ALTER COLUMN org_id SET DEFAULT 1;
ALTER TABLE replies        ALTER COLUMN org_id SET DEFAULT 1;
ALTER TABLE bounces        ALTER COLUMN org_id SET DEFAULT 1;
ALTER TABLE cron_log       ALTER COLUMN org_id SET DEFAULT 1;
ALTER TABLE daily_metrics  ALTER COLUMN org_id SET DEFAULT 1;
ALTER TABLE error_log      ALTER COLUMN org_id SET DEFAULT 1;
ALTER TABLE sequence_state ALTER COLUMN org_id SET DEFAULT 1;
ALTER TABLE config         ALTER COLUMN org_id SET DEFAULT 1;
ALTER TABLE niches         ALTER COLUMN org_id SET DEFAULT 1;
ALTER TABLE offer          ALTER COLUMN org_id SET DEFAULT 1;
ALTER TABLE icp_profile    ALTER COLUMN org_id SET DEFAULT 1;
ALTER TABLE saved_views    ALTER COLUMN org_id SET DEFAULT 1;
ALTER TABLE lead_signals   ALTER COLUMN org_id SET DEFAULT 1;
ALTER TABLE reject_list    ALTER COLUMN org_id SET DEFAULT 1;
