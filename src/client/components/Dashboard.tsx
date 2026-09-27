import { useCallback, useEffect, useState } from 'react';
import { api, type DashboardData, type BillingSummary, type FreeTierStatus, type TrendPoint } from '../api';
import { CostChart } from './CostChart';
import { CostTrendChart } from './CostTrendChart';
import { FreeTierCard } from './FreeTierCard';
import { UsageDetailModal } from './UsageDetailModal';
import { TrendingUp, DollarSign, AlertTriangle, Calendar } from 'lucide-react';

// Cloudflare Analytics retains roughly 90 days of data, so older months are not
// queryable. Offer only the current month plus the two prior.
const RETAINED_MONTHS = 3;

function parseErrorDetail(message: string): string {
  try {
    const parsed = JSON.parse(message) as { detail?: string; error?: string };
    const detail = parsed.detail || parsed.error;
    if (detail && /\b429\b|\b10429\b|rate.?limit/i.test(detail)) {
      return 'Cloudflare 分析 API 正在限流，请稍候重试。';
    }
    if (detail && /older than|retention|cannot request data older/i.test(detail)) {
      return '该月份超出了 Cloudflare 分析约 90 天的保留窗口，请选择更近的月份。';
    }
    return detail || message;
  } catch {
    return message;
  }
}

// Build a list of the last `count` months as { value: 'YYYY-MM', label: '2026年9月' }.
function recentMonths(count: number): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    out.push({ value, label });
  }
  return out;
}

export function Dashboard() {
  const months = recentMonths(RETAINED_MONTHS);
  const [month, setMonth] = useState<string>(months[0].value);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<FreeTierStatus | null>(null);
  const [trend, setTrend] = useState<TrendPoint[] | null>(null);

  const loadDashboard = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .getDashboard(month)
      .then(setData)
      .catch((err) => setError(parseErrorDetail(err.message)))
      .finally(() => setLoading(false));
  }, [month]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // The cost trend is account-level (month-independent), so fetch it once on
  // mount in parallel with the dashboard data instead of after it renders.
  useEffect(() => {
    api
      .getTrend()
      .then((d) => setTrend(d.trend))
      .catch(() => setTrend([]));
  }, []);

  const monthLabel = months.find((m) => m.value === month)?.label ?? month;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">仪表盘</h2>
          <p className="text-sm text-slate-400">
            你的 Cloudflare 用量与成本总览。数据来自分析 API（约 60 秒聚合延迟，仅供预警参考）。
          </p>
          {data?.plan && data.plan.plans.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-500">检测到套餐：</span>
              {data.plan.plans.map((p) => (
                <span
                  key={p}
                  className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-300"
                >
                  {p}
                </span>
              ))}
            </div>
          )}
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
        <div className="card flex flex-col items-start gap-3">
          <div className="flex items-center gap-3 text-red-400">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>{error || '加载仪表盘数据失败'}</span>
          </div>
          <button
            onClick={loadDashboard}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            重试
          </button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {data.summaries.map((summary) => (
              <SummaryCard key={summary.accountId} summary={summary} periodLabel={monthLabel} />
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <CostChart data={data.dailyUsage} />
            <CostTrendChart trend={trend} />
          </div>

          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">免费额度状态</h3>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> 免费额度内
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> 超免费额度（套餐内，不计费）
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-500" /> 将产生计费
                </span>
              </div>
            </div>
            {data.freeTierStatus.length === 0 ? (
              <div className="card text-sm text-slate-400">
                该时段暂无用量数据。
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {data.freeTierStatus.map((status) => (
                  <FreeTierCard
                    key={`${status.product}-${status.metric}`}
                    status={status}
                    onClick={() => setDetail(status)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {detail && (
        <UsageDetailModal status={detail} month={month} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

function SummaryCard({ summary, periodLabel }: { summary: BillingSummary; periodLabel: string }) {
  return (
    <div className="card">
      <div className="mb-2 flex items-center gap-2 text-sm text-slate-400">
        <DollarSign className="h-4 w-4" />
        {periodLabel}
      </div>
      <div className="text-2xl font-bold text-slate-100">
        {summary.currency} {summary.currentMonthCost.toFixed(2)}
      </div>
      <div className="text-[11px] text-slate-500">预估用量成本</div>
      <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
        <span>上月：{summary.currency} {summary.previousMonthCost.toFixed(2)}</span>
        <span className="flex items-center gap-1 text-indigo-400">
          <TrendingUp className="h-3 w-3" />
          月底预测：{summary.currency} {summary.forecastedCost.toFixed(2)}
        </span>
      </div>
      <div className="mt-2 text-xs text-slate-600">{summary.accountName}</div>
    </div>
  );
}
