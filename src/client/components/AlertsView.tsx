import { useEffect, useState } from 'react';
import { Mail, Send, Bot, MessageSquare, Building2 } from 'lucide-react';

interface AlertSettings {
  email: string;
  enabled: boolean;
  warnThreshold: number;
  channels: { email: boolean; telegram: boolean; wecomBot: boolean; wecomApp: boolean };
  available: { email: boolean; telegram: boolean; wecomBot: boolean; wecomApp: boolean };
  plan: 'free' | 'paid';
  paidUntil: string | null;
  requiresPayment: boolean;
  entitled: boolean;
}

type ChannelKey = 'email' | 'telegram' | 'wecomBot' | 'wecomApp';

const CHANNEL_META: Array<{
  key: ChannelKey;
  label: string;
  icon: typeof Mail;
  hint: string;
}> = [
  { key: 'email', label: '邮件（Resend）', icon: Mail, hint: '需要配置 RESEND_API_KEY' },
  { key: 'telegram', label: 'Telegram', icon: Send, hint: '需要配置 TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID' },
  { key: 'wecomBot', label: '企微群机器人', icon: MessageSquare, hint: '需要配置 WECOM_WEBHOOK_KEY' },
  { key: 'wecomApp', label: '企微自建应用', icon: Building2, hint: '需要配置 WECOM_CORP_ID / SECRET / AGENTID' },
];

export function AlertsView() {
  const [email, setEmail] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [warnThreshold, setWarnThreshold] = useState(80);
  const [channels, setChannels] = useState<AlertSettings['channels']>({
    email: true,
    telegram: false,
    wecomBot: false,
    wecomApp: false,
  });
  const [available, setAvailable] = useState<AlertSettings['available'] | null>(null);
  const [plan, setPlan] = useState<AlertSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/alerts', { credentials: 'same-origin' })
      .then((res) => (res.ok ? (res.json() as Promise<AlertSettings>) : null))
      .then((d) => {
        if (!d) return;
        setEmail(d.email);
        setEnabled(d.enabled);
        setWarnThreshold(d.warnThreshold);
        setChannels(d.channels);
        setAvailable(d.available);
        setPlan(d);
      })
      .catch(() => undefined);
  }, []);

  const save = async (next?: { enabled?: boolean }) => {
    const nextEnabled = next?.enabled ?? enabled;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/settings/alerts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, enabled: nextEnabled, warnThreshold, channels }),
      });
      setMsg(res.ok ? '已保存' : '邮箱地址无效');
    } catch {
      setMsg('保存失败');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch('/api/dashboard/alert-test', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = (await res.json()) as { sent?: boolean; reason?: string };
      setTestMsg(
        res.ok && body.sent
          ? '测试告警已发送'
          : `未发送：${body.reason === 'No channel enabled' ? '未启用任何渠道' : body.reason || '错误'}`
      );
    } catch {
      setTestMsg('测试告警发送失败');
    } finally {
      setTesting(false);
      setTimeout(() => setTestMsg(null), 5000);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">告警通知</h2>
        <p className="text-sm text-slate-400">
          每天推送一封摘要：有指标开始计费、接近免费额度上限，或月底预测超出预算时，主题会带上警示标记。
        </p>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Mail className="h-5 w-5 text-indigo-400" />
          每日摘要
        </div>

        {plan?.requiresPayment && !plan.entitled && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            自动每日告警是付费功能（约 $10–12/年）。你仍可在下方发送测试告警；套餐生效后定时摘要自动恢复。
          </div>
        )}

        <label className="mb-2 flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              void save({ enabled: e.target.checked });
            }}
            className="h-4 w-4 rounded border-slate-600 bg-slate-950"
          />
          给我发送每日摘要
        </label>

        <label className="mb-1 block text-sm font-medium text-slate-300">
          告警阈值（用量达到免费额度的百分比）
        </label>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            max={100}
            value={warnThreshold}
            onChange={(e) => setWarnThreshold(Number(e.target.value))}
            className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
          <span className="text-sm text-slate-400">%</span>
          <span className="text-xs text-slate-500">指标用量 ≥ 该百分比时进入"值得关注"清单（默认 80）</span>
        </div>

        <label className="mb-1 block text-sm font-medium text-slate-300">推送渠道</label>
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          {CHANNEL_META.map((ch) => {
            const configured = !available || available[ch.key];
            return (
              <label
                key={ch.key}
                title={configured ? undefined : `服务端未配置凭据：${ch.hint}`}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                  channels[ch.key]
                    ? 'border-indigo-500/40 bg-indigo-500/5 text-slate-100'
                    : 'border-slate-700 bg-slate-950/40 text-slate-400'
                } ${configured ? '' : 'opacity-60'}`}
              >
                <input
                  type="checkbox"
                  checked={channels[ch.key]}
                  onChange={(e) => setChannels({ ...channels, [ch.key]: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-950"
                />
                <span>
                  <span className="flex items-center gap-1.5 font-medium">
                    <ch.icon className="h-4 w-4" />
                    {ch.label}
                  </span>
                  {!configured && (
                    <span className="mt-0.5 block text-xs text-amber-400/80">服务端未配置凭据，勾选后不会发送</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>

        <label className="mb-1 block text-sm font-medium text-slate-300">收件邮箱</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com（多个用英文逗号分隔）"
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
          <button
            onClick={() => void save()}
            disabled={saving}
            className="btn-primary gap-2 disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
        {msg && <span className="text-xs text-slate-400">{msg}</span>}

        <div className="mt-3">
          <button
            onClick={sendTest}
            disabled={testing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
          >
            <Bot className="h-4 w-4" />
            {testing ? '发送中…' : '发送测试告警'}
          </button>
          {testMsg && <span className="ml-3 text-sm text-slate-300">{testMsg}</span>}
        </div>
      </div>
    </div>
  );
}
