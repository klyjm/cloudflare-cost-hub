import type { D1Database } from '@cloudflare/workers-types';

export interface UserAlertSetting {
  userId: string;
  email: string | null; // recipient(s), comma-separated; null = use login email
  enabled: boolean;
  lastSentDate: string | null;
  plan: 'free' | 'paid';
  paidUntil: string | null;
  warnThreshold: number; // % of free-tier allowance that flags a metric
  channelEmail: boolean;
  channelTelegram: boolean;
  channelWecomBot: boolean;
  channelWecomApp: boolean;
}

const SELECT_COLUMNS =
  'user_id, email, enabled, last_sent_date, plan, paid_until, warn_threshold, channel_email, channel_telegram, channel_wecom_bot, channel_wecom_app';

function mapRow(r: Record<string, unknown>): UserAlertSetting {
  return {
    userId: String(r.user_id),
    email: r.email ? String(r.email) : null,
    enabled: Number(r.enabled) === 1,
    lastSentDate: r.last_sent_date ? String(r.last_sent_date) : null,
    plan: String(r.plan) === 'paid' ? 'paid' : 'free',
    paidUntil: r.paid_until ? String(r.paid_until) : null,
    warnThreshold: r.warn_threshold != null ? Number(r.warn_threshold) : 80,
    channelEmail: Number(r.channel_email ?? 1) === 1,
    channelTelegram: Number(r.channel_telegram) === 1,
    channelWecomBot: Number(r.channel_wecom_bot) === 1,
    channelWecomApp: Number(r.channel_wecom_app) === 1,
  };
}

export async function getUserAlertSetting(
  db: D1Database,
  userId: string
): Promise<UserAlertSetting | null> {
  const r = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM user_alert_settings WHERE user_id = ?`)
    .bind(userId)
    .first();
  return r ? mapRow(r as Record<string, unknown>) : null;
}

// Upsert the user-editable fields (recipients, toggle, threshold, channels).
// Billing fields (plan / paid_until) are managed separately by the payment
// webhook, so they are left untouched here and default to 'free' / null on
// first insert.
export async function upsertUserAlertSetting(
  db: D1Database,
  userId: string,
  fields: {
    email: string | null;
    enabled: boolean;
    warnThreshold: number;
    channels: { email: boolean; telegram: boolean; wecomBot: boolean; wecomApp: boolean };
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_alert_settings
         (user_id, email, enabled, warn_threshold, channel_email, channel_telegram, channel_wecom_bot, channel_wecom_app, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         email = excluded.email,
         enabled = excluded.enabled,
         warn_threshold = excluded.warn_threshold,
         channel_email = excluded.channel_email,
         channel_telegram = excluded.channel_telegram,
         channel_wecom_bot = excluded.channel_wecom_bot,
         channel_wecom_app = excluded.channel_wecom_app,
         updated_at = excluded.updated_at`
    )
    .bind(
      userId,
      fields.email,
      fields.enabled ? 1 : 0,
      fields.warnThreshold,
      fields.channels.email ? 1 : 0,
      fields.channels.telegram ? 1 : 0,
      fields.channels.wecomBot ? 1 : 0,
      fields.channels.wecomApp ? 1 : 0,
      new Date().toISOString()
    )
    .run();
}

export async function listEnabledAlertSettings(db: D1Database): Promise<UserAlertSetting[]> {
  const { results } = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM user_alert_settings WHERE enabled = 1`)
    .all();
  return (results || []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function setAlertLastSent(
  db: D1Database,
  userId: string,
  date: string
): Promise<void> {
  await db
    .prepare('UPDATE user_alert_settings SET last_sent_date = ? WHERE user_id = ?')
    .bind(date, userId)
    .run();
}
