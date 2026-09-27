import { Hono } from 'hono';
import { getAssetFromKV, type Options } from '@cloudflare/kv-asset-handler';
import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import type { Env } from './types';
import auth from './routes/auth';
import cfOauth from './routes/cf-oauth';
import dashboard from './routes/dashboard';
import settings from './routes/settings';
import budgetsRoute from './routes/budgets';
import { accountFromEnv, captureRetainedMonths } from './snapshots';
import { accountInputForConnected, listConnectedAccounts } from './cf-oauth';
import { runDailyAlerts } from './alerts';
import manifestJSON from '__STATIC_CONTENT_MANIFEST';

const app = new Hono<{ Bindings: Env }>();

app.route('/api/auth', auth);
app.route('/api/auth/cf', cfOauth);
app.route('/api/dashboard', dashboard);
app.route('/api/settings', settings);
app.route('/api/budgets', budgetsRoute);

app.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }));

// Serve React SPA for non-API routes
app.all('*', async (c) => {
  const manifest = JSON.parse(manifestJSON) as Options['ASSET_MANIFEST'];
  const assetNamespace = c.env.__STATIC_CONTENT;
  if (!assetNamespace) {
    return c.text('Static content not configured', 500);
  }

  try {
    return await getAssetFromKV(
      {
        request: c.req.raw,
        waitUntil: (promise: Promise<unknown>) => c.executionCtx.waitUntil(promise),
      } as never,
      {
        ASSET_NAMESPACE: assetNamespace as Options['ASSET_NAMESPACE'],
        ASSET_MANIFEST: manifest,
      }
    );
  } catch {
    // SPA fallback for client-side routes (e.g. /settings, /services): serve
    // index.html. Its KV key is content-hashed, so resolve it via the manifest.
    const manifestMap = JSON.parse(manifestJSON) as Record<string, string>;
    const indexKey = manifestMap['index.html'] || 'index.html';
    const index = await assetNamespace.get(indexKey, { type: 'text' });
    if (index) {
      return c.newResponse(index, 200, { 'Content-Type': 'text/html; charset=utf-8' });
    }
    return c.text('Not Found', 404);
  }
});

// Capture a daily snapshot for every distinct connected Cloudflare account,
// plus the env-configured account as a fallback. Accounts are deduplicated so an
// account authorized by multiple users (or also set via env) is captured once.
async function snapshotAllAccounts(env: Env): Promise<void> {
  const seen = new Set<string>();
  const envAccount = accountFromEnv(env);
  if (envAccount) {
    seen.add(envAccount.accountId);
    await captureRetainedMonths(env, envAccount).catch((err) =>
      console.error(`Scheduled snapshot failed (env ${envAccount.accountId}):`, err)
    );
  }

  let connected: Awaited<ReturnType<typeof listConnectedAccounts>> = [];
  try {
    connected = await listConnectedAccounts(env);
  } catch (err) {
    console.error('Listing connected accounts failed:', err);
  }

  for (const acc of connected) {
    if (seen.has(acc.accountId)) continue;
    seen.add(acc.accountId);
    try {
      const input = await accountInputForConnected(env, acc);
      if (input) await captureRetainedMonths(env, input);
    } catch (err) {
      console.error(`Scheduled snapshot failed (${acc.accountId}):`, err);
    }
  }
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  // Daily: snapshot cost history (survives Cloudflare's ~90 day retention) and
  // email a usage/cost digest.
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        await snapshotAllAccounts(env);
        await runDailyAlerts(env).catch((err) => console.error('Scheduled alert failed:', err));
      })()
    );
  },
};
