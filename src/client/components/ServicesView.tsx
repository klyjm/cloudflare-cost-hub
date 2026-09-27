import { useEffect, useState } from 'react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { Calendar, AlertTriangle, Layers, Server } from 'lucide-react';
import { api, type ServicesAnalysis, type Tier, type CostDriver, type ServiceSummary } from '../api';

const TIER_STYLE: Record<Tier, { dot: string; text: string; badge: string; label: string }> = {
  free: { dot: 'bg-emerald-500', text: 'text-emerald-400', badge: 'bg-emerald-500/10 text-emerald-400', label: '免费额度内' },
  paid: { dot: 'bg-amber-500', text: 'text-amber-400', badge: 'bg-amber-500/10 text-amber-400', label: '套餐内' },
  billable: { dot: 'bg-red-500', text: 'text-red-400', badge: 'bg-red-500/10 text-red-400', label: '将计费' },
};

function compact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function recentMonths(count: number): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: `${d.getFullYear()}年${d.getMonth() + 1}月`,
    });
  }
  return out;
}

export function ServicesView() {
  const months = recentMonths(3);
  const [month, setMonth] = useState(months[0].value);
  const [data, setData] = useState<ServicesAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getServices(month)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [month]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">服务用量</h2>
          <p className="text-sm text-slate-400">跨服务的用量大户排名与各服务明细。</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <Calendar className="h-4 w-4" />
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : error || !data ? (
        <div className="card flex items-center gap-3 text-red-400">
          <AlertTriangle className="h-5 w-5" />
          {error || '加载服务分析失败'}
        </div>
      ) : (
        <>
          <TopDrivers drivers={data.topDrivers} />
          <ByService services={data.services} trends={data.trends} />
        </>
      )}
    </div>
  );
}

function TopDrivers({ drivers }: { drivers: CostDriver[] }) {
  return (
    <div className="card">
      <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold">
        <Server className="h-5 w-5 text-indigo-400" />
        用量 Top 来源
      </h3>
      <p className="mb-3 text-xs text-slate-500">
        本月消耗最多的实例（按预估成本、再按付费套餐占用比例排序）。
      </p>
      {drivers.length === 0 ? (
        <div className="text-sm text-slate-400">本月没有可归因的用量。</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60 text-left text-xs text-slate-400">
              <tr>
                <th className="px-3 py-2">实例</th>
                <th className="px-3 py-2">服务</th>
                <th className="px-3 py-2 text-right">用量</th>
                <th className="px-3 py-2 text-right">付费占比</th>
                <th className="px-3 py-2 text-right">预估成本</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={`${d.product}-${d.metric}-${d.id}`} className="border-t border-slate-800">
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-slate-200" title={d.id}>
                      {d.label.length > 32 ? `${d.label.slice(0, 32)}…` : d.label}
                    </span>
                    <span className="ml-1 text-[11px] text-slate-600">{d.instanceLabel}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {d.product} · {d.metric}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300">
                    {compact(d.value)} {d.unit.split('/')[0]}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400">
                    {d.paidShare !== undefined ? `${(d.paidShare * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td
                    className={`px-3 py-2 text-right ${
                      d.estimatedCost > 0 ? 'text-red-400' : 'text-emerald-400'
                    }`}
                  >
                    ${d.estimatedCost.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ByService({
  services,
  trends,
}: {
  services: ServiceSummary[];
  trends: ServicesAnalysis['trends'];
}) {
  const trendOf = (product: string) => trends.find((t) => t.product === product)?.points ?? [];

  return (
    <div>
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <Layers className="h-5 w-5 text-indigo-400" />
        分服务明细
      </h3>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {services.map((s) => {
          const style = TIER_STYLE[s.tier];
          const points = trendOf(s.product);
          return (
            <div key={s.product} className="card">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <h4 className="font-medium text-slate-100">{s.product}</h4>
                  <span className={`text-xs ${style.text}`}>
                    本月预估 ${s.totalCost.toFixed(2)}
                  </span>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${style.badge}`}>
                  {style.label}
                </span>
              </div>

              {points.length >= 2 && (
                <div className="mb-2 h-10">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={points}>
                      <YAxis hide domain={[0, 'dataMax']} />
                      <Line
                        type="monotone"
                        dataKey="cost"
                        stroke="#818cf8"
                        strokeWidth={1.5}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="space-y-1">
                {s.metrics.map((m) => (
                  <div
                    key={m.metric}
                    className="flex items-center justify-between text-xs text-slate-400"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${TIER_STYLE[m.tier].dot}`} />
                      {m.metric}
                    </span>
                    <span>
                      免费额度 {m.percentage.toFixed(0)}%
                      {(m.estimatedCost ?? 0) > 0 && (
                        <span className="ml-1 text-red-400">· ${m.estimatedCost!.toFixed(2)}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
