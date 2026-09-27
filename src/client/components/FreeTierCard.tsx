import { ChevronRight } from 'lucide-react';
import type { FreeTierStatus } from '../api';

interface FreeTierCardProps {
  status: FreeTierStatus;
  onClick?: () => void;
}

type Tier = 'free' | 'paid' | 'billable';

// Three-state classification:
//  - free:     within the free-tier allowance (green)
//  - paid:     over the free tier but within the paid-plan allowance, no cost (amber)
//  - billable: over the paid-plan allowance, actually incurring cost (red)
function classify(status: FreeTierStatus): Tier {
  if ((status.estimatedCost ?? 0) > 0) return 'billable';
  if (status.percentage >= 100) return status.paidIncluded !== undefined ? 'paid' : 'billable';
  return 'free';
}

const TIER_STYLES: Record<Tier, { bar: string; badgeBg: string; badgeText: string; label: string }> = {
  free: { bar: 'bg-emerald-500', badgeBg: 'bg-emerald-500/10', badgeText: 'text-emerald-400', label: '免费额度内' },
  paid: { bar: 'bg-amber-500', badgeBg: 'bg-amber-500/10', badgeText: 'text-amber-400', label: '套餐内' },
  billable: { bar: 'bg-red-500', badgeBg: 'bg-red-500/10', badgeText: 'text-red-400', label: '将计费' },
};

function compact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function FreeTierCard({ status, onClick }: FreeTierCardProps) {
  const tier = classify(status);
  const style = TIER_STYLES[tier];
  const cost = status.estimatedCost ?? 0;
  const paidPct =
    status.paidIncluded && status.paidIncluded > 0
      ? Math.min(100, ((status.monthlyUsed ?? 0) / status.paidIncluded) * 100)
      : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="card w-full cursor-pointer text-left transition-colors hover:border-slate-600"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-1 text-sm font-medium text-slate-200">
            {status.product}
            <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
          </h4>
          <p className="text-xs text-slate-500">{status.metric}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${style.badgeBg} ${style.badgeText}`}
        >
          {tier === 'billable' ? `~$${cost.toFixed(2)}` : style.label}
        </span>
      </div>

      {/* Free-tier usage (per the limit's period) */}
      <div className="mb-1 h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full ${style.bar}`}
          style={{ width: `${Math.min(100, status.percentage)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-slate-400">
        <span>
          {status.used.toLocaleString()} / {status.limit.toLocaleString()}
        </span>
        <span>
          {status.percentage.toFixed(1)}% · {status.unit}
        </span>
      </div>

      {/* Paid-plan headroom (monthly) */}
      {status.paidIncluded !== undefined && (
        <div className="mt-3 border-t border-slate-800 pt-2">
          <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-indigo-500/70"
              style={{ width: `${paidPct}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-slate-500">
            <span>
              付费套餐：{compact(status.monthlyUsed ?? 0)} / {compact(status.paidIncluded)} 每月
            </span>
            <span className={cost > 0 ? 'text-red-400' : 'text-emerald-400'}>
              预估 ${cost.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </button>
  );
}
