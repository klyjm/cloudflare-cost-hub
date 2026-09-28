import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestD1, type TestD1 } from '../helpers/d1';
import {
  upsertUserAlertSetting,
  getUserAlertSetting,
  listEnabledAlertSettings,
} from '../../src/server/db/user-alert-settings';

let t: TestD1;
beforeEach(() => {
  t = createTestD1();
});
afterEach(() => t.close());

describe('user_alert_settings', () => {
  it('round-trips recipient + enabled + digest + threshold/channels, defaulting to the free plan', async () => {
    await upsertUserAlertSetting(t.db, 'u1', {
      email: 'a@x.com',
      enabled: true,
      digestEnabled: false,
      warnThreshold: 90,
      channels: { email: true, telegram: true, wecomBot: false, wecomApp: false },
    });
    const s = await getUserAlertSetting(t.db, 'u1');
    expect(s).toMatchObject({
      userId: 'u1',
      email: 'a@x.com',
      enabled: true,
      digestEnabled: false,
      plan: 'free',
      paidUntil: null,
      warnThreshold: 90,
      channelEmail: true,
      channelTelegram: true,
      channelWecomBot: false,
      channelWecomApp: false,
    });
  });

  it('falls back to the default threshold and digest-on for legacy rows', async () => {
    await upsertUserAlertSetting(t.db, 'u1', {
      email: 'a@x.com',
      enabled: true,
      digestEnabled: true,
      warnThreshold: 80,
      channels: { email: true, telegram: false, wecomBot: false, wecomApp: false },
    });
    const s = await getUserAlertSetting(t.db, 'u1');
    expect(s?.warnThreshold).toBe(80);
    expect(s?.digestEnabled).toBe(true);
  });

  it('lists only enabled users', async () => {
    await upsertUserAlertSetting(t.db, 'u1', {
      email: 'a@x.com',
      enabled: true,
      digestEnabled: true,
      warnThreshold: 80,
      channels: { email: true, telegram: false, wecomBot: false, wecomApp: false },
    });
    await upsertUserAlertSetting(t.db, 'u2', {
      email: 'b@x.com',
      enabled: false,
      digestEnabled: true,
      warnThreshold: 80,
      channels: { email: true, telegram: false, wecomBot: false, wecomApp: false },
    });
    const enabled = await listEnabledAlertSettings(t.db);
    expect(enabled.map((s) => s.userId)).toEqual(['u1']);
  });
});
