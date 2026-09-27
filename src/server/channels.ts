import type { Env } from './types';

// Alert delivery channels. Credentials live in env/secrets only; the request
// hosts below are fixed constants, never user-supplied URLs.

export interface AlertChannelFlags {
  email: boolean;
  telegram: boolean;
  wecomBot: boolean;
  wecomApp: boolean;
}

export interface DigestPayload {
  subject: string; // email subject
  text: string; // plain-text body for IM channels
  html: string; // HTML body for email
}

// Which channels have their env credentials present (for UI hints).
export function channelAvailability(env: Env): AlertChannelFlags {
  return {
    email: Boolean(env.RESEND_API_KEY),
    telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    wecomBot: Boolean(env.WECOM_WEBHOOK_KEY),
    wecomApp: Boolean(env.WECOM_CORP_ID && env.WECOM_CORP_SECRET && env.WECOM_AGENTID),
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

async function sendTelegram(env: Env, text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: truncate(text, 4000) }),
    });
    if (!res.ok) {
      console.error('Telegram send failed:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Telegram send failed:', err);
    return false;
  }
}

// 企业微信群机器人 webhook（固定 qyapi.weixin.qq.com，key 来自 env）。
async function sendWecomBot(env: Env, text: string): Promise<boolean> {
  if (!env.WECOM_WEBHOOK_KEY) return false;
  try {
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${env.WECOM_WEBHOOK_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content: truncate(text, 4000) } }),
    });
    if (!res.ok) {
      console.error('WeCom bot send failed:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('WeCom bot send failed:', err);
    return false;
  }
}

// 企业微信自建应用消息：gettoken 换 access_token 后调 message/send。
async function sendWecomApp(env: Env, text: string): Promise<boolean> {
  if (!env.WECOM_CORP_ID || !env.WECOM_CORP_SECRET || !env.WECOM_AGENTID) return false;
  try {
    const tokenUrl = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(
      env.WECOM_CORP_ID
    )}&corpsecret=${encodeURIComponent(env.WECOM_CORP_SECRET)}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenJson = (await tokenRes.json()) as { access_token?: string; errmsg?: string };
    if (!tokenJson.access_token) {
      console.error('WeCom app token failed:', tokenJson.errmsg);
      return false;
    }
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${tokenJson.access_token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: env.WECOM_TO_USER || '@all',
        msgtype: 'text',
        agentid: Number(env.WECOM_AGENTID),
        text: { content: truncate(text, 2000) },
      }),
    });
    const json = (await res.json()) as { errcode?: number; errmsg?: string };
    if (!res.ok || (json.errcode ?? 0) !== 0) {
      console.error('WeCom app send failed:', json.errcode, json.errmsg);
      return false;
    }
    return true;
  } catch (err) {
    console.error('WeCom app send failed:', err);
    return false;
  }
}

async function sendEmail(
  env: Env,
  payload: DigestPayload,
  to: string[]
): Promise<boolean> {
  if (!env.RESEND_API_KEY || to.length === 0) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.ALERT_EMAIL_FROM || 'Cloudflare Cost Hub <noreply@0xkaz.com>',
        to,
        subject: payload.subject,
        html: payload.html,
      }),
    });
    if (!res.ok) {
      console.error('Resend send failed:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Resend send failed:', err);
    return false;
  }
}

// Send the digest over every enabled (and credentialed) channel.
// Returns true when at least one channel actually went out.
export async function sendDigest(
  env: Env,
  flags: AlertChannelFlags,
  payload: DigestPayload,
  emailTo: string[]
): Promise<boolean> {
  const results: Array<Promise<boolean>> = [];
  if (flags.email) results.push(sendEmail(env, payload, emailTo));
  if (flags.telegram) results.push(sendTelegram(env, payload.text));
  if (flags.wecomBot) results.push(sendWecomBot(env, payload.text));
  if (flags.wecomApp) results.push(sendWecomApp(env, payload.text));
  if (results.length === 0) return false;
  const sent = await Promise.all(results);
  return sent.some(Boolean);
}
