-- Decouple the daily digest from alerts: when digest_enabled is off, pushes go
-- out only on real alert conditions (billable usage / budget overage).
ALTER TABLE user_alert_settings ADD COLUMN digest_enabled INTEGER NOT NULL DEFAULT 1;
