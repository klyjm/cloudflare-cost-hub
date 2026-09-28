import { Hono } from 'hono';
import type { Env } from '../types';
import { getSession } from '../auth';
import { findWorkspacesByUserId } from '../db/workspace';
import { fetchAccountUsage, fetchInstanceBreakdown, generateDemoUsage, type AccountUsage } from '../cloudflare-api';
import { getFreeTierLimits, findLimit } from '../db/free-tier';
import { captureRetainedMonths, getCostTrend } from '../snapshots';
import { getAccountPlan } from '../cloudflare-rest';
import { getServicesAnalysis } from '../services';
import { runDailyAlertForUser } from '../alerts';
import { isRateLimit } from '../http';
import { getUserAlertSetting } from '../db/user-alert-settings';
import { resolveCloudflareAccount } from '../cf-oauth';
import { bustAccountCache, cacheKey, cachedJson } from '../cache';
import type { DashboardData } from '../../shared/types';

// Cloudflare usage data has daily granularity, so a few minutes of caching is
// invisible to users but removes most live GraphQL round-trips on the hot path.
const DASH_TTL = 300; // seconds
const SERVICES_TTL = 300;
const TREND_TTL = 600;

const dashboard = new Hono<{ Bindings: Env }>();

dashboard.use(async (c, next) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  c.set('session' as never, session);
  await next();
});

dashboard.get('/', async (c) => {
  const session = c.get('session' as never) as { userId: string; email: string };
  const workspaces = await findWorkspacesByUserId(c.env.DB, session.userId);

  // Phase 1: single workspace, demo data unless accounts are linked.
  const workspace = workspaces[0];
  if (!workspace) {
    return c.json({ summaries: [], dailyUsage: [], freeTierStatus: [] });
  }

  const limits = await getFreeTierLimits(c.env.DB);

  // Optional ?month=YYYY-MM selects a historical month (defaults to current).
  const monthParam = c.req.query('month');
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : undefined;

  // Prefer the user's connected Cloudflare account (OAuth); fall back to the
  // env-configured account, otherwise demo data so the dashboard still renders.
  const account = await resolveCloudflareAccount(c.env, session.userId);

  // Demo data (no account) is cheap and varies — produce it directly.
  if (!account) {
    return c.json(buildDashboardData(generateDemoUsage(limits)));
  }

  try {
    return await cachedJson(
      c,
      cacheKey('dash', account.accountId, month ?? 'current'),
      DASH_TTL,
      async () => {
        const usage = await fetchAccountUsage(account, limits, { month });
        // Detect the account's paid plan so the UI can explain why over-free
        // usage may still be $0. Best-effort; omitted on failure.
        let plan: DashboardData['plan'];
        try {
          plan = await getAccountPlan(account);
        } catch {
          plan = undefined;
        }
        return buildDashboardData(usage, plan);
      }
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('Cloudflare usage fetch failed:', detail);
    if (isRateLimit(detail)) {
      return c.json(
        { error: 'Cloudflare is rate-limiting analytics requests right now. Please wait a moment and retry.', rateLimited: true },
        429
      );
    }
    return c.json({ error: 'Failed to fetch Cloudflare usage', detail }, 502);
  }
});

function buildDashboardData(usage: AccountUsage, plan?: DashboardData['plan']): DashboardData {
  return {
    summaries: [
      {
        accountId: usage.accountId,
        accountName: usage.accountName,
        currentMonthCost: usage.currentMonthCost,
        previousMonthCost: usage.previousMonthCost,
        forecastedCost: usage.forecastedCost,
        currency: usage.currency,
      },
    ],
    dailyUsage: usage.dailyUsage,
    freeTierStatus: usage.freeTierStatus,
    plan,
  };
}

// Per-instance breakdown for a single product/metric, loaded on demand by the
// detail view to show which database/bucket/namespace/script drives the quota.
dashboard.get('/breakdown', async (c) => {
  const product = c.req.query('product');
  const metric = c.req.query('metric');
  if (!product || !metric) {
    return c.json({ error: 'product and metric are required' }, 400);
  }

  const session = c.get('session' as never) as { userId: string };
  const account = await resolveCloudflareAccount(c.env, session.userId);
  if (!account) {
    return c.json({ error: 'Cloudflare account not configured' }, 400);
  }

  const monthParam = c.req.query('month');
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : undefined;

  const limits = await getFreeTierLimits(c.env.DB);
  const unit = findLimit(limits, product, metric)?.unit ?? '';

  try {
    const breakdown = await fetchInstanceBreakdown(account, product, metric, unit, { month });
    if (!breakdown) {
      return c.json({ error: 'Per-instance breakdown is not available for this metric' }, 404);
    }
    return c.json(breakdown);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('Breakdown fetch failed:', detail);
    return c.json({ error: 'Failed to fetch breakdown', detail }, 502);
  }
});

// Service-centric analysis: per-product summaries, cross-service top cost
// drivers, and per-service monthly trends.
dashboard.get('/services', async (c) => {
  const session = c.get('session' as never) as { userId: string };
  const account = await resolveCloudflareAccount(c.env, session.userId);
  if (!account) {
    return c.json({ error: 'Cloudflare account not configured' }, 400);
  }
  const monthParam = c.req.query('month');
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : undefined;
  try {
    return await cachedJson(
      c,
      cacheKey('services', account.accountId, month ?? 'current'),
      SERVICES_TTL,
      () => getServicesAnalysis(c.env, account, month)
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('Services analysis failed:', detail);
    return c.json({ error: 'Failed to build services analysis', detail }, 502);
  }
});

// Monthly cost trend (persists beyond Cloudflare's ~90 day retention via D1/R2
// snapshots). The current month is recomputed live on each request.
dashboard.get('/trend', async (c) => {
  const session = c.get('session' as never) as { userId: string };
  try {
    const account = await resolveCloudflareAccount(c.env, session.userId);
    if (!account) return c.json({ trend: await getCostTrend(c.env, null) });
    return await cachedJson(c, cacheKey('trend', account.accountId), TREND_TTL, async () => ({
      trend: await getCostTrend(c.env, account),
    }));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('Trend fetch failed:', detail);
    return c.json({ error: 'Failed to build cost trend', detail }, 502);
  }
});

// Send a test alert email to the signed-in user immediately (bypasses the
// once-per-day guard). Uses their saved preferences, or a sensible default.
dashboard.post('/alert-test', async (c) => {
  const session = c.get('session' as never) as { userId: string };
  try {
    const saved = await getUserAlertSetting(c.env.DB, session.userId);
    const setting = saved ?? {
      userId: session.userId,
      email: null,
      enabled: true,
      digestEnabled: true,
      lastSentDate: null,
      plan: 'free' as const,
      paidUntil: null,
      warnThreshold: 80,
      channelEmail: true,
      channelTelegram: false,
      channelWecomBot: false,
      channelWecomApp: false,
    };
    const result = await runDailyAlertForUser(c.env, setting, true);
    return c.json(result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('Alert test failed:', detail);
    return c.json({ error: 'Failed to send alert', detail }, 502);
  }
});

// Manually capture snapshots now (current month + backfill of retained months),
// the same work the daily scheduled handler does. Lets a user fill their trend
// immediately without waiting for the cron.
dashboard.post('/snapshot', async (c) => {
  const session = c.get('session' as never) as { userId: string };
  try {
    const account = await resolveCloudflareAccount(c.env, session.userId);
    if (!account) return c.json({ error: 'Cloudflare account not configured' }, 400);
    await captureRetainedMonths(c.env, account);
    await bustAccountCache(c.env, account.accountId);
    return c.json({ ok: true });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('Snapshot capture failed:', detail);
    return c.json({ error: 'Failed to capture snapshot', detail }, 502);
  }
});

export default dashboard;
