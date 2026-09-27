import { Suspense } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Settings, LogOut, Cloud, Layers, Wallet, Mail, Heart } from 'lucide-react';
import { AccountSwitcher } from './AccountSwitcher';

// This project is open source and free to self-host. The hosted instance is
// kept running on donations — update this link to your Ko-fi / GitHub Sponsors
// page (or set it to '' to hide the Support link entirely).
const SUPPORT_URL = 'https://ko-fi.com/0xkaz';

interface LayoutProps {
  onLogout: () => void;
}

function PageSpinner() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
    </div>
  );
}

export function Layout({ onLogout }: LayoutProps) {
  const location = useLocation();

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: '仪表盘' },
    { to: '/services', icon: Layers, label: '服务用量' },
    { to: '/budgets', icon: Wallet, label: '预算' },
    { to: '/alerts', icon: Mail, label: '告警' },
    { to: '/settings', icon: Settings, label: '设置' },
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-64 flex-col border-r border-slate-800 bg-slate-900">
        <div className="flex items-center gap-2 px-6 py-5 text-lg font-semibold text-indigo-400">
          <Cloud className="h-6 w-6" />
          CF Cost Hub
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {navItems.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-indigo-600/10 text-indigo-400'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-2 border-t border-slate-800 p-4">
          <AccountSwitcher />
          {SUPPORT_URL && (
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-pink-300/80 hover:bg-slate-800 hover:text-pink-300"
            >
              <Heart className="h-3.5 w-3.5" />
              支持这个项目
            </a>
          )}
          <button
            onClick={onLogout}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <LogOut className="h-3.5 w-3.5" />
            退出登录
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-8">
        <Suspense fallback={<PageSpinner />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
