import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  // Optional R2 archive for full raw usage snapshots (snapshots.ts writes
  // best-effort inside try/catch). Unbound simply disables the archive copy —
  // the D1 snapshot rows remain the source of truth for trends.
  BUCKET?: R2Bucket;
  SESSION_SECRET: string;
  // Cloudflare Analytics API token + account for live cost/usage data.
  // When unset, the dashboard falls back to demo data.
  CF_ANALYTICS_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_ACCOUNT_NAME?: string;
  // Public base URL of this deployment, used for links in alert emails. Falls
  // back to the reference deployment's URL when unset.
  APP_URL?: string;
  // Email alerts via Resend. When RESEND_API_KEY is unset, alerts are disabled.
  RESEND_API_KEY?: string;
  ALERT_EMAIL_FROM?: string;
  ALERT_EMAIL_TO?: string;
  // Telegram channel: bot token (secret) + chat id (non-sensitive).
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  // 企业微信群机器人：webhook key（secret，不含 URL 主体）。
  WECOM_WEBHOOK_KEY?: string;
  // 企业微信自建应用：corpid + secret（secret）+ agentid；touser 缺省 @all。
  WECOM_CORP_ID?: string;
  WECOM_CORP_SECRET?: string;
  WECOM_AGENTID?: string;
  WECOM_TO_USER?: string;
  // Comma-separated allowlist of Cloudflare user ids / login emails that may
  // sign in. Unset or empty keeps upstream behavior (open registration).
  ALLOWED_CF_USERS?: string;
  // Monetization flag. While unset/"false", every enabled user receives alerts
  // (no payment enforced yet). Set to "true" to gate automated alerts behind a
  // paid plan (user_alert_settings.plan / paid_until).
  ALERTS_REQUIRE_PAYMENT?: string;
  // Cloudflare OAuth (self-managed client) for per-user account connections.
  CF_OAUTH_CLIENT_ID?: string;
  CF_OAUTH_CLIENT_SECRET?: string;
  CF_OAUTH_REDIRECT_URI?: string;
  // Extra OAuth scopes appended to the built-in read scopes (space-separated).
  // e.g. "user-details.read" to enable the real verified email via /user.
  CF_OAUTH_EXTRA_SCOPES?: string;
  TOKEN_ENC_KEY?: string; // base64 32-byte AES-GCM key for encrypting stored tokens
  // Optional KV cache for computed dashboard/usage responses. When unbound, the
  // app recomputes on every request (see server/cache.ts).
  CACHE?: KVNamespace;
  __STATIC_CONTENT: KVNamespace;
}

export interface Session {
  userId: string;
  email: string;
}
