import { useEffect, useState } from 'react';
import { Key, Cloud, Camera, CheckCircle2 } from 'lucide-react';

interface ConfiguredAccount {
  name: string;
  accountId: string;
  tokenConfigured: boolean;
  plan?: { workersPaid: boolean; r2Paid: boolean; plans: string[]; accessible: boolean };
}

interface CfConnection {
  connected: boolean;
  accountId?: string;
  accountName?: string;
  oauthAvailable: boolean;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 py-2 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-200">{value}</span>
    </div>
  );
}

export function Settings() {
  const [account, setAccount] = useState<ConfiguredAccount | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);
  const [conn, setConn] = useState<CfConnection | null>(null);

  useEffect(() => {
    fetch('/api/settings/account', { credentials: 'same-origin' })
      .then((res) => (res.ok ? (res.json() as Promise<ConfiguredAccount>) : null))
      .then(setAccount)
      .catch(() => undefined);
    fetch('/api/auth/cf/status', { credentials: 'same-origin' })
      .then((res) => (res.ok ? (res.json() as Promise<CfConnection>) : null))
      .then(setConn)
      .catch(() => undefined);
  }, []);

  const captureSnapshot = async () => {
    setCapturing(true);
    setCaptureMsg(null);
    try {
      const res = await fetch('/api/dashboard/snapshot', {
        method: 'POST',
        credentials: 'same-origin',
      });
      setCaptureMsg(res.ok ? '成本历史已更新。' : '快照失败。');
    } catch {
      setCaptureMsg('快照失败。');
    } finally {
      setCapturing(false);
      setTimeout(() => setCaptureMsg(null), 4000);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">设置</h2>
        <p className="text-sm text-slate-400">
          账号、套餐与数据——均在服务端通过 Worker 环境变量与密钥配置。
        </p>
      </div>

      <div className="card">
        <div className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Cloud className="h-5 w-5 text-indigo-400" />
          Cloudflare 账号
          {conn?.connected && (
            <span className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> 已通过 OAuth 连接
            </span>
          )}
        </div>
        <Row label="账号名称" value={account?.name || '—'} />
        <Row
          label="账号 ID"
          value={<span className="font-mono text-xs">{account?.accountId || '—'}</span>}
        />
        <Row
          label="API 令牌"
          value={
            account?.tokenConfigured ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <Key className="h-3.5 w-3.5" /> 已配置
              </span>
            ) : (
              <span className="text-amber-400">未配置</span>
            )
          }
        />
      </div>

      {/* Only shown when subscriptions are actually readable. OAuth tokens lack a
          billing scope, so plan detection is impossible there — hide the card
          entirely rather than show a misleading "no paid plans". */}
      {account?.plan?.accessible && (
        <div className="card">
          <div className="mb-1 text-lg font-semibold">检测到的套餐</div>
          <p className="mb-3 text-xs text-slate-500">
            自动检测自你的 Cloudflare 订阅。成本估算会使用这些套餐的包含额度。
          </p>
          {account.plan.plans.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {account.plan.plans.map((p) => (
                <span
                  key={p}
                  className="rounded-full bg-indigo-500/10 px-3 py-1 text-sm font-medium text-indigo-300"
                >
                  {p}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              未检测到付费订阅——用量受免费额度的硬性上限约束。
            </p>
          )}
        </div>
      )}

      <div className="card">
        <div className="mb-1 text-lg font-semibold">成本历史</div>
        <p className="mb-3 text-xs text-slate-500">
          <span className="text-slate-300">月度成本趋势</span> 图表由每日快照构成，同时把历史保留到
          Cloudflare 约 90 天分析窗口之外。快照每天自动运行——点这里可以立即补齐，不用等下一次定时任务。
        </p>
        <button
          onClick={captureSnapshot}
          disabled={capturing}
          className="btn-primary gap-2 disabled:opacity-60"
        >
          <Camera className="h-4 w-4" />
          {capturing ? '补齐中…' : '立即补齐成本历史'}
        </button>
        {captureMsg && (
          <span className="ml-3 inline-flex items-center gap-1 text-sm text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            {captureMsg}
          </span>
        )}
      </div>
    </div>
  );
}
