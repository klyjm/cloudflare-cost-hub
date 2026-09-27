-- Per-user alert delivery channels and a GUI-adjustable warning threshold.
ALTER TABLE user_alert_settings ADD COLUMN warn_threshold INTEGER NOT NULL DEFAULT 80;
ALTER TABLE user_alert_settings ADD COLUMN channel_email INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_alert_settings ADD COLUMN channel_telegram INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_alert_settings ADD COLUMN channel_wecom_bot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_alert_settings ADD COLUMN channel_wecom_app INTEGER NOT NULL DEFAULT 0;
