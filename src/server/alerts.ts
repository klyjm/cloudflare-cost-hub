import type { Env } from './types';
import type { CloudflareAccountInput } from './cloudflare-api';
import type { CostDriver, ServiceMetricSummary, ServicesAnalysis, Tier } from '../shared/types';
import { getServicesAnalysis } from './services';
import { resolveCloudflareAccount } from './cf-oauth';
import { getSetting } from './db/app-settings';
import { findUserById } from './db/user';
import {
  listEnabledAlertSettings,
  setAlertLastSent,
  type UserAlertSetting,
} from './db/user-alert-settings';
import { getBudget } from './db/budgets';
import { getAccountEntitlement } from './db/account-entitlements';
import { evaluateBudget, type BudgetStatus } from './budgets';
import { sendDigest, type AlertChannelFlags, type DigestPayload } from './channels';

export const ALERT_EMAIL_KEY = 'alert_email';

// Default share of a metric's free-tier allowance that flags it; each user can
// override this from the alerts page (user_alert_settings.warn_threshold).
export const DEFAULT_WARN_THRESHOLD = 80;

// Billing entitlement for automated alerts, evaluated against the monitored
// Cloudflare account's plan (not the individual user) — teammates sharing an
// account share its paid status. Enforced only when env ALERTS_REQUIRE_PAYMENT=
// "true"; otherwise everyone is entitled, so a future operator could gate
// automated alerts behind a paid plan with a pure config flip. The reference
// deployment leaves it unset (all features free).
export function isEntitled(
  env: Env,
  entitlement: { plan: 'free' | 'paid'; paidUntil: string | null }
): boolean {
  if (env.ALERTS_REQUIRE_PAYMENT !== 'true') return true;
  if (entitlement.plan === 'paid') return true;
  if (entitlement.paidUntil && new Date(entitlement.paidUntil).getTime() > Date.now()) return true;
  return false;
}

const TIER_COLOR: Record<Tier, string> = {
  free: '#34d399',
  paid: '#fbbf24',
  billable: '#f87171',
};
const TIER_EMOJI: Record<Tier, string> = {
  free: '🟢',
  paid: '🟡',
  billable: '🔴',
};
const TIER_RANK: Record<Tier, number> = { free: 0, paid: 1, billable: 2 };

function parseRecipients(raw: string | null | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

// Env-fallback recipients (used only when no user has configured per-user
// alerts): the legacy global app setting, then the env default.
async function envRecipients(env: Env): Promise<string[]> {
  const configured = await getSetting(env.DB, ALERT_EMAIL_KEY);
  return parseRecipients(configured || env.ALERT_EMAIL_TO);
}

function allMetrics(analysis: ServicesAnalysis): ServiceMetricSummary[] {
  return analysis.services
    .flatMap((s) => s.metrics)
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.percentage - a.percentage);
}

function noteworthy(
  metrics: ServiceMetricSummary[],
  threshold: number = DEFAULT_WARN_THRESHOLD
): ServiceMetricSummary[] {
  return metrics.filter((m) => (m.estimatedCost ?? 0) > 0 || m.percentage >= threshold);
}

function compact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const TD = 'padding:6px 10px;border-top:1px solid #1e293b;';
const TH = 'padding:6px 10px;color:#94a3b8;font-size:12px;text-align:left;';

function metricsTable(metrics: ServiceMetricSummary[]): string {
  const rows = metrics
    .map(
      (m) => `<tr>
        <td style="${TD}">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${TIER_COLOR[m.tier]};margin-right:6px;"></span>
          ${m.product} · ${m.metric}
        </td>
        <td style="${TD}text-align:right;color:#cbd5e1;">${m.used.toLocaleString()} / ${m.limit.toLocaleString()} ${m.unit}</td>
        <td style="${TD}text-align:right;color:${TIER_COLOR[m.tier]};">${m.percentage.toFixed(0)}%${(m.estimatedCost ?? 0) > 0 ? ` · $${m.estimatedCost!.toFixed(2)}` : ''}</td>
      </tr>`
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead><tr><th style="${TH}">指标</th><th style="${TH}text-align:right;">用量</th><th style="${TH}text-align:right;">状态</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function driversTable(drivers: CostDriver[]): string {
  if (drivers.length === 0) return '';
  const rows = drivers
    .slice(0, 10)
    .map(
      (d) => `<tr>
        <td style="${TD}font-family:ui-monospace,monospace;font-size:12px;">${d.label.length > 34 ? `${d.label.slice(0, 34)}…` : d.label} <span style="color:#64748b;">${d.instanceLabel}</span></td>
        <td style="${TD}color:#94a3b8;font-size:12px;">${d.product} · ${d.metric}</td>
        <td style="${TD}text-align:right;color:#cbd5e1;">${compact(d.value)}</td>
        <td style="${TD}text-align:right;color:${d.estimatedCost > 0 ? '#f87171' : '#34d399'};">${d.paidShare !== undefined ? `${(d.paidShare * 100).toFixed(1)}%` : '—'}${d.estimatedCost > 0 ? ` · $${d.estimatedCost.toFixed(2)}` : ''}</td>
      </tr>`
    )
    .join('');
  return `<h3 style="margin:24px 0 8px;font-size:15px;">用量 Top 来源</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr><th style="${TH}">实例</th><th style="${TH}">服务</th><th style="${TH}text-align:right;">用量</th><th style="${TH}text-align:right;">付费占比</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
}

function budgetBanner(budget: BudgetStatus | null): string {
  if (!budget) return '';
  const color = budget.exceeded ? '#f87171' : budget.nearing ? '#fbbf24' : '#34d399';
  const label = budget.exceeded
    ? '月底预测将超出预算'
    : budget.nearing
      ? '月底预测接近预算'
      : '月底预测在预算之内';
  return `<div style="margin:0 0 16px;padding:10px 14px;border-radius:8px;background:${color}1a;border:1px solid ${color}40;">
    <span style="color:${color};font-weight:600;">${label}</span>
    <span style="color:#cbd5e1;"> — 预测 $${budget.forecast.toFixed(2)} / 预算 $${budget.limit.toFixed(2)}（${budget.percentage}%）</span>
  </div>`;
}

function buildEmail(
  analysis: ServicesAnalysis,
  budget: BudgetStatus | null,
  appUrl: string
): { subject: string; html: string } {
  const metrics = allMetrics(analysis);
  const flagged = noteworthy(metrics);
  const billableCount = metrics.filter((m) => m.tier === 'billable').length;

  const subject = budget?.exceeded
    ? `🚨 预算告警：月底预测 $${analysis.forecastedCost.toFixed(2)}，超出预算 $${budget.limit.toFixed(2)}`
    : billableCount
      ? `⚠️ Cloudflare 用量告警：本月预估 $${analysis.currentMonthCost.toFixed(2)}`
      : `Cloudflare 每日用量报告：${flagged.length} 项指标需要关注`;

  const html = `<div style="font-family:ui-sans-serif,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;border-radius:12px;max-width:680px;">
    <h2 style="margin:0 0 4px;">Cloudflare Cost Hub</h2>
    <p style="margin:0 0 16px;color:#94a3b8;font-size:14px;">${analysis.accountName} — 每日用量报告（${analysis.month}）</p>
    ${budgetBanner(budget)}
    <div style="display:flex;gap:24px;margin-bottom:8px;">
      <div><div style="font-size:12px;color:#94a3b8;">预估本月成本</div><div style="font-size:22px;font-weight:700;">$${analysis.currentMonthCost.toFixed(2)}</div></div>
      <div><div style="font-size:12px;color:#94a3b8;">月底预测</div><div style="font-size:22px;font-weight:700;color:#818cf8;">$${analysis.forecastedCost.toFixed(2)}</div></div>
    </div>
    <h3 style="margin:24px 0 8px;font-size:15px;">用量状态（全部服务）</h3>
    ${metricsTable(metrics)}
    ${driversTable(analysis.topDrivers)}
    <p style="margin:24px 0 0;font-size:12px;color:#64748b;">
      <a href="${appUrl}/" style="color:#818cf8;">打开仪表盘</a> ·
      🔴 将产生计费 · 🟡 超出免费额度（套餐内） · 🟢 免费额度内
    </p>
    <p style="margin:8px 0 0;font-size:12px;color:#64748b;">
      数据来自 Cloudflare 分析 API（约 60 秒聚合延迟，高流量下可能存在采样误差），仅供预警参考，不作为账单依据。
    </p>
  </div>`;

  return { subject, html };
}

// Plain-text digest for IM channels (Telegram / 企业微信). Concise: headline
// numbers + every metric, tier-flagged, capped so long accounts stay readable.
function buildText(analysis: ServicesAnalysis, budget: BudgetStatus | null): string {
  const metrics = allMetrics(analysis);
  const flagged = noteworthy(metrics);
  const lines: string[] = [
    `☁️ Cloudflare Cost Hub — ${analysis.accountName}`,
    `每日用量摘要（${analysis.month}）`,
    `预估本月：$${analysis.currentMonthCost.toFixed(2)} ｜ 月底预测：$${analysis.forecastedCost.toFixed(2)}`,
  ];
  if (budget) {
    const mark = budget.exceeded ? '🔴 超支' : budget.nearing ? '🟡 接近' : '🟢 正常';
    lines.push(`预算：预测 $${budget.forecast.toFixed(2)} / 上限 $${budget.limit.toFixed(2)}（${budget.percentage}%）${mark}`);
  }
  lines.push('————');
  const shown = metrics.slice(0, 12);
  for (const m of shown) {
    const cost = (m.estimatedCost ?? 0) > 0 ? `，预估 $${m.estimatedCost!.toFixed(2)}` : '';
    lines.push(`${TIER_EMOJI[m.tier]} ${m.product}·${m.metric}：${compact(m.used)} / ${compact(m.limit)} ${m.unit}（${m.percentage.toFixed(0)}%${cost}）`);
  }
  if (metrics.length > shown.length) lines.push(`…其余 ${metrics.length - shown.length} 项从略`);
  if (flagged.length > 0) lines.push(`⚠️ ${flagged.length} 项指标需要关注`);
  lines.push('（分析数据约 60 秒延迟、可能有采样误差，仅供预警，非账单）');
  return lines.join('\n');
}

function buildPayload(
  analysis: ServicesAnalysis,
  budget: BudgetStatus | null,
  appUrl: string
): DigestPayload {
  const { subject, html } = buildEmail(analysis, budget, appUrl);
  return { subject, text: buildText(analysis, budget), html };
}

async function getLastSentDate(env: Env): Promise<string | null> {
  try {
    const row = await env.DB.prepare(
      "SELECT last_sent_date FROM alert_state WHERE id = 'daily'"
    ).first();
    return row ? String(row.last_sent_date) : null;
  } catch {
    return null;
  }
}

async function setLastSentDate(env: Env, date: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO alert_state (id, last_sent_date) VALUES ('daily', ?)
     ON CONFLICT(id) DO UPDATE SET last_sent_date = excluded.last_sent_date`
  )
    .bind(date)
    .run();
}

export interface AlertResult {
  sent: boolean;
  reason?: string;
  count?: number;
}

function channelFlags(setting: {
  channelEmail: boolean;
  channelTelegram: boolean;
  channelWecomBot: boolean;
  channelWecomApp: boolean;
}): AlertChannelFlags {
  return {
    email: setting.channelEmail,
    telegram: setting.channelTelegram,
    wecomBot: setting.channelWecomBot,
    wecomApp: setting.channelWecomApp,
  };
}

// Build a usage/cost digest for one account and push it over every enabled
// channel. Skips empty reports unless `force` is set (the manual test endpoint).
// Send rules (when not forced):
//   - a budget overage always sends;
//   - digest mode (daily digest on): send when anything is noteworthy;
//   - alert-only mode (daily digest off): send only when something is actually
//     billable — near-threshold warnings and routine stats stay silent.
async function buildAndSend(
  env: Env,
  account: CloudflareAccountInput,
  opts: {
    flags: AlertChannelFlags;
    emailTo: string[];
    force: boolean;
    budgetLimit: number | null;
    warnThreshold: number;
    digest: boolean;
  }
): Promise<AlertResult> {
  const analysis = await getServicesAnalysis(env, account);
  const metrics = allMetrics(analysis);
  const flagged = noteworthy(metrics, opts.warnThreshold);
  const budget = opts.budgetLimit != null ? evaluateBudget(opts.budgetLimit, analysis.forecastedCost) : null;
  if (!opts.force && !budget?.exceeded) {
    const billable = metrics.some((m) => (m.estimatedCost ?? 0) > 0);
    const skip = opts.digest ? flagged.length === 0 : !billable;
    if (skip) {
      return {
        sent: false,
        reason: opts.digest ? 'Nothing to report' : 'No alert condition',
        count: flagged.length,
      };
    }
  }
  const appUrl = (env.APP_URL || '').replace(/\/+$/, '') || 'https://cloudflare-cost-hub.0xkaz.com';
  const payload = buildPayload(analysis, budget, appUrl);
  const send = await sendDigest(env, opts.flags, payload, opts.emailTo);
  return {
    sent: send.ok,
    count: flagged.length,
    reason: send.ok ? undefined : send.errors.join('；'),
  };
}

// Resolve a user's recipients: their configured address(es), else their login
// email. Returns [] if neither is available.
async function recipientsForUser(env: Env, setting: UserAlertSetting): Promise<string[]> {
  const explicit = parseRecipients(setting.email);
  if (explicit.length > 0) return explicit;
  const user = await findUserById(env.DB, setting.userId);
  return user?.email ? [user.email] : [];
}

// Send a single user's daily digest for their connected account. Honors the
// per-user enable toggle, channel selection, billing entitlement, and
// once-per-day idempotency.
export async function runDailyAlertForUser(
  env: Env,
  setting: UserAlertSetting,
  force = false
): Promise<AlertResult> {
  const flags = channelFlags(setting);
  if (!flags.email && !flags.telegram && !flags.wecomBot && !flags.wecomApp) {
    return { sent: false, reason: 'No channel enabled' };
  }
  if (!setting.enabled) return { sent: false, reason: 'Alerts disabled' };

  const today = new Date().toISOString().slice(0, 10);
  if (!force && setting.lastSentDate === today) {
    return { sent: false, reason: 'Already sent today' };
  }

  const account = await resolveCloudflareAccount(env, setting.userId);
  if (!account) return { sent: false, reason: 'No account connected' };

  // Entitlement is per Cloudflare account, so check it once the account is known.
  const entitlement = await getAccountEntitlement(env.DB, account.accountId);
  if (!isEntitled(env, entitlement)) return { sent: false, reason: 'Paid plan required' };

  const to = flags.email ? await recipientsForUser(env, setting) : [];

  const budget = await getBudget(env.DB, setting.userId, account.accountId);
  const result = await buildAndSend(env, account, {
    flags,
    emailTo: to,
    force,
    budgetLimit: budget?.monthlyLimit ?? null,
    warnThreshold: setting.warnThreshold || DEFAULT_WARN_THRESHOLD,
    digest: setting.digestEnabled,
  });
  if (result.sent) await setAlertLastSent(env.DB, setting.userId, today);
  return result;
}

// Legacy single-tenant digest for the env-configured account (email only).
// Used only as a fallback when no user has configured per-user alerts, so the
// original deployment keeps emailing before anyone self-serves.
async function runDailyAlertsEnvFallback(env: Env, force: boolean): Promise<AlertResult> {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'Alerts not configured' };
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) {
    return { sent: false, reason: 'No account configured' };
  }
  const today = new Date().toISOString().slice(0, 10);
  if (!force && (await getLastSentDate(env)) === today) {
    return { sent: false, reason: 'Already sent today' };
  }
  const acct = await resolveCloudflareAccount(env, undefined);
  if (!acct) return { sent: false, reason: 'No account configured' };
  const to = await envRecipients(env);
  if (to.length === 0) return { sent: false, reason: 'No recipient' };

  const result = await buildAndSend(env, acct, {
    flags: { email: true, telegram: false, wecomBot: false, wecomApp: false },
    emailTo: to,
    force,
    budgetLimit: null,
    warnThreshold: DEFAULT_WARN_THRESHOLD,
    digest: true,
  });
  if (result.sent) await setLastSentDate(env, today);
  return result;
}

// Scheduled entry point: push every enabled (and entitled) user their digest
// over their chosen channels. Falls back to the legacy env-account email digest
// when no user has configured alerts.
export async function runDailyAlerts(env: Env, force = false): Promise<AlertResult> {
  const settings = await listEnabledAlertSettings(env.DB);
  if (settings.length === 0) {
    return runDailyAlertsEnvFallback(env, force);
  }

  let sent = 0;
  for (const setting of settings) {
    try {
      const r = await runDailyAlertForUser(env, setting, force);
      if (r.sent) sent++;
    } catch (err) {
      console.error('User alert failed:', setting.userId, err);
    }
  }
  return { sent: sent > 0, count: sent };
}
