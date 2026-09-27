import type { Env } from './types';
import { fetchAccountUsage, type CloudflareAccountInput } from './cloudflare-api';
import { getFreeTierLimits } from './db/free-tier';
import {
  adoptLegacySnapshots,
  getMonthlyCosts,
  hasSnapshotForMonth,
  upsertSnapshot,
  type MonthlyCost,
} from './db/snapshots';

// Cloudflare Analytics retains ~90 days, so only the current month and the two
// prior months can be recomputed live; older months rely on stored snapshots.
const RETAINED_MONTHS = 3;
const TREND_MONTHS = 6;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function recentMonthKeys(count: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  return out;
}

// The env-configured account, when present, queried by the scheduled handler as
// a fallback before any user connects their own Cloudflare account via OAuth.
export function accountFromEnv(env: Env): CloudflareAccountInput | null {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) return null;
  return {
    accountId: env.CF_ACCOUNT_ID,
    apiToken: env.CF_ANALYTICS_TOKEN,
    name: env.CF_ACCOUNT_NAME || 'Cloudflare Account',
  };
}

// Capture a usage/cost snapshot for `account` and `month` (current month if
// omitted) into D1 and R2. Returns the captured month-to-date cost.
export async function captureSnapshot(
  env: Env,
  account: CloudflareAccountInput,
  month?: string
): Promise<MonthlyCost | null> {
  // The env account, on its first capture, adopts any legacy single-account rows
  // so pre-multi-tenant history stays attached to the right account series.
  if (account.accountId === env.CF_ACCOUNT_ID) {
    await adoptLegacySnapshots(env.DB, account.accountId).catch(() => {});
  }

  const now = new Date();
  const currentMonth = monthKey(now);
  const targetMonth = month ?? currentMonth;
  const limits = await getFreeTierLimits(env.DB);
  const usage = await fetchAccountUsage(account, limits, { month: targetMonth });

  // Date the snapshot: today for the current month, otherwise the month's last day.
  let date: string;
  if (targetMonth === currentMonth) {
    date = ymd(now);
  } else {
    const [y, m] = targetMonth.split('-').map(Number);
    date = ymd(new Date(Date.UTC(y, m, 0)));
  }

  const payload = JSON.stringify(
    usage.freeTierStatus.map((s) => ({
      product: s.product,
      metric: s.metric,
      used: s.used,
      percentage: s.percentage,
      estimatedCost: s.estimatedCost ?? 0,
    }))
  );

  await upsertSnapshot(env.DB, {
    accountId: account.accountId,
    date,
    month: targetMonth,
    cost: usage.currentMonthCost,
    forecast: usage.forecastedCost,
    capturedAt: now.toISOString(),
    payload,
  });

  // Archive the full snapshot to R2 for durable history (keyed by account).
  // Optional binding: when no R2 bucket is bound this is simply skipped — the
  // D1 row above is the source of truth for trends.
  if (env.BUCKET) {
    try {
      await env.BUCKET.put(
        `snapshots/${account.accountId}/${date}.json`,
        JSON.stringify({ accountId: account.accountId, date, month: targetMonth, usage })
      );
    } catch {
      // R2 archival is best-effort.
    }
  }

  return { month: targetMonth, cost: usage.currentMonthCost, forecast: usage.forecastedCost };
}

export interface TrendPoint {
  month: string;
  cost: number | null;
  forecast: number | null;
}

// Capture the current month plus any not-yet-stored retained months for an
// account. Run from the daily cron (and the manual snapshot button) so the
// request path can read the trend without any live Cloudflare API calls.
export async function captureRetainedMonths(
  env: Env,
  account: CloudflareAccountInput
): Promise<void> {
  const now = new Date();
  const currentMonth = monthKey(now);
  for (const month of recentMonthKeys(RETAINED_MONTHS, now)) {
    if (month === currentMonth || !(await hasSnapshotForMonth(env.DB, account.accountId, month))) {
      try {
        await captureSnapshot(env, account, month);
      } catch {
        // Skip months that fail (e.g. just outside the retention window).
      }
    }
  }
}

// Build a monthly cost trend for one account from stored snapshots only — no
// live Cloudflare calls on the request path (the daily cron keeps snapshots
// fresh via captureRetainedMonths). With no account returns an empty set.
export async function getCostTrend(
  env: Env,
  account: CloudflareAccountInput | null
): Promise<TrendPoint[]> {
  const now = new Date();
  const months = recentMonthKeys(TREND_MONTHS, now).reverse();
  if (!account) return months.map((month) => ({ month, cost: null, forecast: null }));

  const stored = await getMonthlyCosts(env.DB, account.accountId);
  const byMonth = new Map(stored.map((m) => [m.month, m]));
  return months.map((month) => {
    const m = byMonth.get(month);
    return { month, cost: m ? m.cost : null, forecast: m ? m.forecast : null };
  });
}
