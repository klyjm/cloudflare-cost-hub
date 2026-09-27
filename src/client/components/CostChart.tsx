import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Dot,
} from 'recharts';
import { AlertTriangle } from 'lucide-react';
import type { UsageMetric } from '../api';
import { detectSpikes } from '../lib/anomaly';

interface CostChartProps {
  data: UsageMetric[];
}

export function CostChart({ data }: CostChartProps) {
  const spikes = detectSpikes(data.map((d) => ({ date: d.date, value: d.value })));
  const chartData = data.map((d) => ({
    date: d.date.slice(5),
    requests: d.value,
    spike: spikes.has(d.date),
  }));
  const spikeCount = chartData.filter((d) => d.spike).length;

  if (chartData.length === 0) {
    return (
      <div className="card flex h-80 flex-col">
        <h3 className="mb-4 text-sm font-semibold text-slate-200">每日请求量</h3>
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
          该时段没有 Workers 请求记录。
        </div>
      </div>
    );
  }

  return (
    <div className="card h-80">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">每日请求量</h3>
        {spikeCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            {spikeCount} 个异常尖峰日
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height="90%">
        <AreaChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <defs>
            <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
          <YAxis stroke="#64748b" fontSize={12} />
          <Tooltip
            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }}
            itemStyle={{ color: '#e2e8f0' }}
          />
          <Area
            type="monotone"
            dataKey="requests"
            stroke="#6366f1"
            fillOpacity={1}
            fill="url(#colorRequests)"
            dot={(props) => {
              const { cx, cy, payload, index } = props;
              return payload.spike ? (
                <Dot key={index} cx={cx} cy={cy} r={4} fill="#f59e0b" stroke="#0f172a" strokeWidth={1} />
              ) : (
                <g key={index} />
              );
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
