import { Cloud, ShieldCheck } from 'lucide-react';

function SignInButton() {
  return (
    <a href="/api/auth/cf/login" className="btn-primary gap-2 px-6 py-3 text-base">
      <svg className="h-5 w-5" viewBox="0 0 48 48" fill="currentColor" aria-hidden="true">
        <path d="M34 30c.4-1.3.3-2.6-.4-3.6-.6-1-1.7-1.6-2.9-1.7l-22-.3c-.2 0-.3-.1-.4-.2 0-.1-.1-.3 0-.4 0-.2.2-.4.5-.4l22.2-.3c2.6-.1 5.4-2.2 6.4-4.7l1.3-3.3c0-.1.1-.2 0-.3C37 6.8 31.4 2.5 24.8 2.5c-6.1 0-11.3 3.9-13.2 9.4-1.2-.9-2.8-1.4-4.5-1.2C4 11 1.7 13.3 1.4 16.2c-.1.7 0 1.4.2 2.1C2 18.2.9 19.8.9 21.6.9 24 2.9 26 5.3 26h27.6c.3 0 .6-.2.7-.5L34 30z" />
      </svg>
      使用 Cloudflare 登录
    </a>
  );
}

export function Login() {
  const loginState = new URLSearchParams(window.location.search).get('login');
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-indigo-950/40 text-slate-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="flex items-center justify-center gap-2 text-lg font-semibold text-indigo-400">
          <Cloud className="h-6 w-6" />
          Cloudflare Cost Hub
        </header>

        <section className="pt-24 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Cloudflare 用量与成本
            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              自托管监控面板
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-slate-400">
            免费额度追踪、分实例用量归因、成本趋势与预算告警——仅限本站所有者使用。
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <SignInButton />
            {loginState === 'denied' && (
              <span className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
                该账号不在本站白名单内，已被拒绝登录。
              </span>
            )}
            {loginState === 'error' && (
              <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
                登录失败，请重试。
              </span>
            )}
            <span className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5" />
              只读分析权限 · 令牌加密存储 · 可随时在 Cloudflare 撤销授权
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
