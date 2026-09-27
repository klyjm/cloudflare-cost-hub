import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import { type TrendPoint } from '../api';

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月`;
}

// `trend === null` means the parent is still loading it. The parent fetches the
// trend in parallel with the dashboard data so this chart never waits on the
// dashboard request to finish first.
export function CostTrendChart({ trend }: { trend: TrendPoint[] | null }) {
  const loading = trend === null;
  const data = (trend || [])
    .filter((p) => p.cost !== null)
    .map((p) => ({ month: monthLabel(p.month), cost: p.cost ?? 0, forecast: p.forecast ?? 0 }));

  return (
    <div className="card h-72">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-200">
        <TrendingUp className="h-4 w-4 text-indigo-400" />
        月度成本趋势
      </h3>
      <p className="mb-3 text-xs text-slate-500">
        预估月度成本。历史来自每日快照，可突破 Cloudflare 约 90 天的分析保留期。
      </p>
      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-slate-500">加载中…</div>
      ) : data.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-slate-500">
          暂无成本历史——快照每天累积一条。
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="80%">
          <ComposedChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
            <YAxis stroke="#64748b" fontSize={12} width={48} tickFormatter={(v) => `$${v}`} />
            <Tooltip
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }}
              itemStyle={{ color: '#e2e8f0' }}
              formatter={(v: number) => `$${v.toFixed(2)}`}
            />
            <Bar dataKey="cost" fill="#6366f1" radius={[3, 3, 0, 0]} name="成本" />
            <Line
              type="monotone"
              dataKey="forecast"
              stroke="#f59e0b"
              strokeDasharray="4 4"
              dot={false}
              name="预测"
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
