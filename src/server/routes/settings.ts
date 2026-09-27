import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { getSession } from '../auth';
import { getAccountPlan } from '../cloudflare-rest';
import { resolveCloudflareAccount } from '../cf-oauth';
import { isEntitled } from '../alerts';
import { getUserAlertSetting, upsertUserAlertSetting } from '../db/user-alert-settings';
import { getAccountEntitlement } from '../db/account-entitlements';

const settings = new Hono<{ Bindings: Env }>();

settings.use(async (c, next) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  c.set('session' as never, session);
  await next();
});

// Returns the Cloudflare account the signed-in user is connected to (their OAuth
// account, or the env-configured fallback) plus the auto-detected paid plan.
settings.get('/account', async (c) => {
  const session = c.get('session' as never) as { userId: string };
  const account = await resolveCloudflareAccount(c.env, session.userId);
  let plan;
  if (account) {
    try {
      plan = await getAccountPlan(account);
    } catch {
      plan = undefined;
    }
  }
  return c.json({
    name: account?.name || '',
    accountId: account?.accountId || '',
    tokenConfigured: Boolean(account),
    plan,
  });
});

// Per-user alert preferences: recipient(s), the enable toggle, warning
// threshold, delivery channels, and the billing entitlement state (plan,
// whether a paid plan is currently required/active).
settings.get('/alerts', async (c) => {
  const session = c.get('session' as never) as { userId: string };
  const s = await getUserAlertSetting(c.env.DB, session.userId);
  const requiresPayment = c.env.ALERTS_REQUIRE_PAYMENT === 'true';

  // Entitlement is per Cloudflare account (shared by everyone watching it).
  const account = await resolveCloudflareAccount(c.env, session.userId);
  const ent = account
    ? await getAccountEntitlement(c.env.DB, account.accountId)
    : { plan: 'free' as const, paidUntil: null };

  return c.json({
    email: s?.email ?? '',
    enabled: s?.enabled ?? true,
    warnThreshold: s?.warnThreshold ?? 80,
    channels: {
      email: s?.channelEmail ?? true,
      telegram: s?.channelTelegram ?? false,
      wecomBot: s?.channelWecomBot ?? false,
      wecomApp: s?.channelWecomApp ?? false,
    },
    // Which channels have their env credentials configured (UI hints).
    available: {
      email: Boolean(c.env.RESEND_API_KEY),
      telegram: Boolean(c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_CHAT_ID),
      wecomBot: Boolean(c.env.WECOM_WEBHOOK_KEY),
      wecomApp: Boolean(c.env.WECOM_CORP_ID && c.env.WECOM_CORP_SECRET && c.env.WECOM_AGENTID),
    },
    plan: ent.plan,
    paidUntil: ent.paidUntil,
    requiresPayment,
    entitled: isEntitled(c.env, { plan: ent.plan, paidUntil: ent.paidUntil }),
  });
});

const channelsSchema = z.object({
  email: z.boolean(),
  telegram: z.boolean(),
  wecomBot: z.boolean(),
  wecomApp: z.boolean(),
});

settings.post(
  '/alerts',
  zValidator(
    'json',
    z.object({
      email: z.string(),
      enabled: z.boolean(),
      warnThreshold: z.number().int().min(1).max(100).default(80),
      channels: channelsSchema.default({
        email: true,
        telegram: false,
        wecomBot: false,
        wecomApp: false,
      }),
    })
  ),
  async (c) => {
    const session = c.get('session' as never) as { userId: string };
    const { email, enabled, warnThreshold, channels } = c.req.valid('json');
    // Allow comma-separated addresses; validate each one looks like an email.
    const list = email.split(',').map((e) => e.trim()).filter(Boolean);
    if (channels.email && list.some((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) {
      return c.json({ error: 'Invalid email address' }, 400);
    }
    await upsertUserAlertSetting(c.env.DB, session.userId, {
      email: list.join(',') || null,
      enabled,
      warnThreshold,
      channels,
    });
    return c.json({ ok: true, email: list.join(','), enabled, warnThreshold, channels });
  }
);

const accountSchema = z.object({
  name: z.string().min(1),
  accountId: z.string().min(1),
  apiToken: z.string().min(1),
});

settings.post('/accounts', zValidator('json', accountSchema), async (c) => {
  const body = c.req.valid('json');
  // Phase 1: validate shape; persist in Phase 3 with encryption.
  return c.json(
    {
      id: crypto.randomUUID(),
      name: body.name,
      accountId: body.accountId,
      createdAt: new Date().toISOString(),
    },
    201
  );
});

export default settings;
