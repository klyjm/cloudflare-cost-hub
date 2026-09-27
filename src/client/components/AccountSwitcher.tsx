import { useEffect, useRef, useState } from 'react';
import { ChevronsUpDown, Check, Cloud } from 'lucide-react';

interface AccountOption {
  id: string;
  name: string;
}

export function AccountSwitcher() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/auth/cf/accounts', { credentials: 'same-origin' })
      .then((res) =>
        res.ok ? (res.json() as Promise<{ accounts: AccountOption[]; activeId: string | null }>) : null
      )
      .then((d) => {
        if (!d) return;
        setAccounts(d.accounts);
        setActiveId(d.activeId);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const active = accounts.find((a) => a.id === activeId);

  const switchTo = async (id: string) => {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      const res = await fetch('/api/auth/cf/account', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: id }),
      });
      if (res.ok) {
        // Reload so every view reflects the newly active account.
        window.location.reload();
        return;
      }
    } finally {
      setSwitching(false);
    }
  };

  // With a single account there is nothing to switch — just show it.
  if (accounts.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-1 text-sm text-slate-300">
        <Cloud className="h-4 w-4 shrink-0 text-indigo-400" />
        <span className="truncate">{active?.name || accounts[0]?.name || '账号'}</span>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={switching}
        className="flex w-full items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-left text-sm text-slate-200 hover:border-slate-600 disabled:opacity-60"
      >
        <Cloud className="h-4 w-4 shrink-0 text-indigo-400" />
        <span className="min-w-0 flex-1 truncate">{active?.name || '选择账号'}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-500" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl">
          <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-slate-500">
            Cloudflare 账号
          </div>
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => switchTo(a.id)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
            >
              <span className="truncate">{a.name}</span>
              {a.id === activeId && <Check className="h-4 w-4 shrink-0 text-indigo-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
