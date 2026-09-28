import { describe, it, expect } from 'vitest';
import { isEntitled, runDailyAlertForUser } from '../../src/server/alerts';
import type { Env } from '../../src/server/types';
import type { UserAlertSetting } from '../../src/server/db/user-alert-settings';

const baseEnv = { RESEND_API_KEY: 'rk_test' } as unknown as Env;

const baseSetting: UserAlertSetting = {
  userId: 'user-1',
  email: 'a@example.com',
  enabled: true,
  digestEnabled: true,
  lastSentDate: null,
  plan: 'free',
  paidUntil: null,
  warnThreshold: 80,
  channelEmail: true,
  channelTelegram: false,
  channelWecomBot: false,
  channelWecomApp: false,
};

const today = new Date().toISOString().slice(0, 10);

describe('isEntitled', () => {
  it('grants everyone when payment is not enforced', () => {
    const env = {} as Env;
    expect(isEntitled(env, { plan: 'free', paidUntil: null })).toBe(true);
  });

  it('requires a paid plan when ALERTS_REQUIRE_PAYMENT=true', () => {
    const env = { ALERTS_REQUIRE_PAYMENT: 'true' } as Env;
    expect(isEntitled(env, { plan: 'free', paidUntil: null })).toBe(false);
    expect(isEntitled(env, { plan: 'paid', paidUntil: null })).toBe(true);
  });

  it('honors a future paid_until even on the free plan', () => {
    const env = { ALERTS_REQUIRE_PAYMENT: 'true' } as Env;
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isEntitled(env, { plan: 'free', paidUntil: future })).toBe(true);
    expect(isEntitled(env, { plan: 'free', paidUntil: past })).toBe(false);
  });
});

describe('runDailyAlertForUser early exits', () => {
  it('skips when every channel is disabled', async () => {
    const r = await runDailyAlertForUser(baseEnv, {
      ...baseSetting,
      channelEmail: false,
      channelTelegram: false,
      channelWecomBot: false,
      channelWecomApp: false,
    });
    expect(r).toEqual({ sent: false, reason: 'No channel enabled' });
  });

  it('skips when the user disabled alerts', async () => {
    const r = await runDailyAlertForUser(baseEnv, { ...baseSetting, enabled: false });
    expect(r).toEqual({ sent: false, reason: 'Alerts disabled' });
  });

  it('skips when already sent today and not forced', async () => {
    const r = await runDailyAlertForUser(baseEnv, { ...baseSetting, lastSentDate: today });
    expect(r).toEqual({ sent: false, reason: 'Already sent today' });
  });
});
