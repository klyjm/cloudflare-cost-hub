import { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { X, AlertTriangle, CheckCircle2, Server } from 'lucide-react';
import { api, type FreeTierStatus, type UsageBreakdown } from '../api';

interface UsageDetailModalProps {
  status: FreeTierStatus;
  month: string;
  onClose: () => void;
}

function formatUSD(n: number): string {
  return `$${n.toFixed(n < 1 && n > 0 ? 4 : 2)}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function UsageDetailModal({ status, month, onClose }: UsageDetailModalProps) {
  const [breakdown, setBreakdown] = useState<UsageBreakdown | null>(null);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(true);

  useEffect(() => {
    setBreakdownLoading(true);
    setBreakdownError(null);
    api
      .getBreakdown(status.product, status.metric, month)
      .then(setBreakdown)
      .catch(() => setBreakdownError('该指标暂无分实例用量明细。'))
      .finally(() => setBreakdownLoading(false));
  }, [status.product, status.metric, month]);
  const isDaily = status.period === 'day';
  // For daily limits, every day above the limit is a breach. For monthly limits,
  // the breach is judged on the running cumulative total.
  let cumulative = 0;
  const chartData = status.daily.map((d) => {
    cumulative += d.value;
    const compare = isDaily ? d.value : cumulative;
    return {
      date: d.date.slice(5),
      value: d.value,
      cumulative,
      over: compare > status.limit,
    };
  });

  const overDays = chartData.filter((d) => d.over);
  const referenceValue = isDaily ? status.limit : undefined;
  const cost = status.estimatedCost ?? 0;
  // Three-state: billable (cost > 0), paid (over free, within paid plan), free.
  const tier: 'free' | 'paid' | 'billable' =
    cost > 0 ? 'billable' : status.percentage >= 100 ? 'paid' : 'free';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="card max-h-[90vh] w-full max-w-3xl overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">
              {status.product} · {status.metric}
            </h3>
            <p className="text-sm text-slate-400">
              {status.used.toLocaleString()} / {status.limit.toLocaleString()} {status.unit}{' '}
              <span
                className={
                  tier === 'billable'
                    ? 'text-red-400'
                    : tier === 'paid'
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }
              >
                ({status.percentage.toFixed(1)}% 免费额度)
              </span>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            tier === 'billable'
              ? 'border-red-500/30 bg-red-500/10 text-red-300'
              : tier === 'paid'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          }`}
        >
          {tier === 'free' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          {tier === 'billable' ? (
            <span>
              已超出付费套餐额度——本月预估成本 ${cost.toFixed(2)}。
            </span>
          ) : tier === 'paid' ? (
            <span>
              已超出免费额度{isDaily && overDays.length > 0 ? `（${overDays.length} 天）` : ''}，但仍在付费套餐额度内——不计费。
            </span>
          ) : (
            <span>本时段用量在免费额度之内。</span>
          )}
        </div>

        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} width={64} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }}
                itemStyle={{ color: '#e2e8f0' }}
                formatter={(v: number) => v.toLocaleString()}
              />
              {referenceValue !== undefined && (
                <ReferenceLine
                  y={referenceValue}
                  stroke="#f87171"
                  strokeDasharray="4 4"
                  label={{ value: '上限', fill: '#f87171', fontSize: 11, position: 'right' }}
                />
              )}
              <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.over ? (tier === 'billable' ? '#ef4444' : '#f59e0b') : '#6366f1'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Free tier vs paid plan comparison */}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <div className="text-xs text-slate-500">免费额度</div>
            <div className="mt-1 text-sm font-semibold text-slate-200">
              {status.limit.toLocaleString()} {status.unit}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <div className="text-xs text-slate-500">付费套餐包含</div>
            <div className="mt-1 text-sm font-semibold text-slate-200">
              {status.paidIncluded !== undefined
                ? `${status.paidIncluded.toLocaleString()} / 月`
                : '包含在套餐内'}
            </div>
            {status.paidPricePerUnit !== undefined && (
              <div className="mt-0.5 text-xs text-slate-500">
                超出后 {formatUSD(status.paidPricePerUnit)} / {status.paidUnitLabel}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <div className="text-xs text-slate-500">本月用量</div>
            <div className="mt-1 text-sm font-semibold text-slate-200">
              {status.monthlyUsed !== undefined ? status.monthlyUsed.toLocaleString() : '—'}
            </div>
            <div
              className={`mt-0.5 text-xs ${
                (status.estimatedCost ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              预估 {formatUSD(status.estimatedCost ?? 0)}
            </div>
          </div>
        </div>

        {/* Per-instance breakdown */}
        <div className="mt-5">
          <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300">
            <Server className="h-4 w-4" />
            按{breakdown?.instanceLabel ?? '实例'}的用量分布
          </h4>
          {breakdownLoading ? (
            <div className="py-6 text-center text-sm text-slate-500">加载中…</div>
          ) : breakdownError || !breakdown ? (
            <div className="text-sm text-slate-500">{breakdownError || '暂无数据。'}</div>
          ) : breakdown.instances.length === 0 ? (
            <div className="text-sm text-slate-500">该时段没有实例级用量。</div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/60 text-left text-xs text-slate-400">
                  <tr>
                    <th className="px-3 py-2">{capitalize(breakdown.instanceLabel)}</th>
                    <th className="px-3 py-2 text-right">用量</th>
                    <th className="px-3 py-2 text-right">占比</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.instances.slice(0, 15).map((inst) => (
                    <tr key={inst.id} className="border-t border-slate-800">
                      <td className="px-3 py-2 font-mono text-xs text-slate-300" title={inst.id}>
                        {inst.label.length > 36 ? `${inst.label.slice(0, 36)}…` : inst.label}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-200">
                        {inst.value.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-400">
                        {breakdown.total > 0
                          ? `${((inst.value / breakdown.total) * 100).toFixed(1)}%`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {breakdown.instances.length > 15 && (
                <div className="bg-slate-900/40 px-3 py-1.5 text-xs text-slate-500">
                  还有 {breakdown.instances.length - 15} 个实例
                </div>
              )}
            </div>
          )}
        </div>

        {isDaily && overDays.length > 0 && (
          <div className="mt-4">
            <h4 className="mb-2 text-sm font-medium text-slate-300">超限日期</h4>
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/60 text-left text-xs text-slate-400">
                  <tr>
                    <th className="px-3 py-2">日期</th>
                    <th className="px-3 py-2 text-right">用量</th>
                    <th className="px-3 py-2 text-right">超出</th>
                  </tr>
                </thead>
                <tbody>
                  {overDays.map((d) => (
                    <tr key={d.date} className="border-t border-slate-800">
                      <td className="px-3 py-2 text-slate-300">{d.date}</td>
                      <td className="px-3 py-2 text-right text-slate-200">
                        {d.value.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-red-400">
                        +{(d.value - status.limit).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
