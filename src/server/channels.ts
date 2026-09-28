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

export interface ChannelSendResult {
  ok: boolean;
  error?: string; // concise, user-displayable failure cause
}

export interface DigestSendResult {
  ok: boolean; // at least one enabled channel actually went out
  errors: string[]; // "<channel>: <cause>" for every failed channel
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

// WeCom errmsgs carry a noisy "hint: [...]" suffix — drop it for the UI.
function shortErrmsg(msg: string | undefined): string {
  return (msg || 'unknown').split('hint')[0].trim().slice(0, 140);
}

async function sendTelegram(env: Env, text: string): Promise<ChannelSendResult> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return { ok: false, error: '未配置 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID' };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: truncate(text, 4000) }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('Telegram send failed:', res.status, body);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('Telegram send failed:', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// 企业微信群机器人 webhook（固定 qyapi.weixin.qq.com，key 来自 env）。
async function sendWecomBot(env: Env, text: string): Promise<ChannelSendResult> {
  if (!env.WECOM_WEBHOOK_KEY) return { ok: false, error: '未配置 WECOM_WEBHOOK_KEY' };
  try {
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${env.WECOM_WEBHOOK_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content: truncate(text, 4000) } }),
    });
    const json = (await res.json().catch(() => ({}))) as { errcode?: number; errmsg?: string };
    if (!res.ok || (json.errcode ?? 0) !== 0) {
      console.error('WeCom bot send failed:', res.status, json.errcode, json.errmsg);
      return { ok: false, error: `errcode ${json.errcode ?? res.status}: ${shortErrmsg(json.errmsg)}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('WeCom bot send failed:', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// 企业微信自建应用消息：gettoken 换 access_token 后调 message/send。
// 自建应用 API 强制校验调用方 IP（企业可信IP），Workers 的共享出口无法满足，
// 因此支持 WECOM_API_BASE 覆盖为固定 IP 的代理（TLS 证书有效、Host/SNI 指向
// qyapi.weixin.qq.com）。群机器人 webhook 无 IP 校验，保持直连不经过代理。
async function sendWecomApp(env: Env, text: string): Promise<ChannelSendResult> {
  if (!env.WECOM_CORP_ID || !env.WECOM_CORP_SECRET || !env.WECOM_AGENTID) {
    return { ok: false, error: '未配置 WECOM_CORP_ID / SECRET / AGENTID' };
  }
  const base = (env.WECOM_API_BASE || 'https://qyapi.weixin.qq.com').replace(/\/+$/, '');
  try {
    const tokenUrl = `${base}/cgi-bin/gettoken?corpid=${encodeURIComponent(
      env.WECOM_CORP_ID
    )}&corpsecret=${encodeURIComponent(env.WECOM_CORP_SECRET)}`;
    const tokenRes = await fetch(tokenUrl);
    if (!tokenRes.ok) {
      const body = (await tokenRes.text()).slice(0, 200);
      const host = new URL(tokenUrl).host;
      console.error('WeCom app gettoken HTTP error:', tokenRes.status, 'host:', host, body);
      return { ok: false, error: `gettoken HTTP ${tokenRes.status} @ ${host}（检查 WECOM_API_BASE 代理）` };
    }
    const tokenJson = (await tokenRes.json().catch(() => null)) as {
      access_token?: string;
      errmsg?: string;
    } | null;
    if (!tokenJson?.access_token) {
      // Empty errmsg here usually means the proxy returned a non-JSON body
      // (e.g. its own error page) — log it verbatim for diagnosis.
      console.error('WeCom app token failed:', JSON.stringify(tokenJson)?.slice(0, 200));
      return { ok: false, error: `gettoken: ${shortErrmsg(tokenJson?.errmsg)}` };
    }
    const res = await fetch(`${base}/cgi-bin/message/send?access_token=${tokenJson.access_token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: env.WECOM_TO_USER || '@all',
        msgtype: 'text',
        agentid: Number(env.WECOM_AGENTID),
        text: { content: truncate(text, 2000) },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { errcode?: number; errmsg?: string };
    if (!res.ok || (json.errcode ?? 0) !== 0) {
      console.error('WeCom app send failed:', json.errcode, json.errmsg);
      return { ok: false, error: `errcode ${json.errcode ?? res.status}: ${shortErrmsg(json.errmsg)}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('WeCom app send failed:', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function sendEmail(env: Env, payload: DigestPayload, to: string[]): Promise<ChannelSendResult> {
  if (!env.RESEND_API_KEY) return { ok: false, error: '未配置 RESEND_API_KEY' };
  if (to.length === 0) return { ok: false, error: '未配置收件邮箱' };
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
      const body = await res.text();
      console.error('Resend send failed:', res.status, body);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('Resend send failed:', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Send the digest over every enabled (and credentialed) channel in parallel.
// Returns ok=true when at least one channel went out, plus per-channel causes
// for every failure so the UI (and Workers Logs) can show what went wrong.
export async function sendDigest(
  env: Env,
  flags: AlertChannelFlags,
  payload: DigestPayload,
  emailTo: string[]
): Promise<DigestSendResult> {
  const tasks: Array<[string, Promise<ChannelSendResult>]> = [];
  if (flags.email) tasks.push(['邮件', sendEmail(env, payload, emailTo)]);
  if (flags.telegram) tasks.push(['Telegram', sendTelegram(env, payload.text)]);
  if (flags.wecomBot) tasks.push(['企微群机器人', sendWecomBot(env, payload.text)]);
  if (flags.wecomApp) tasks.push(['企微自建应用', sendWecomApp(env, payload.text)]);
  if (tasks.length === 0) return { ok: false, errors: ['没有启用任何渠道'] };

  const results = await Promise.all(
    tasks.map(([, p]) =>
      p.catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))
    )
  );
  const errors: string[] = [];
  let ok = false;
  for (let i = 0; i < tasks.length; i++) {
    const r = results[i];
    if (r.ok) {
      ok = true;
    } else {
      errors.push(`${tasks[i][0]}: ${r.error || '发送失败'}`);
    }
  }
  return { ok, errors };
}
