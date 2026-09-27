import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../../src/server/types';
import { createTestD1, type TestD1 } from '../helpers/d1';
import { createSessionToken } from '../../src/server/auth';
import { createUser } from '../../src/server/db/user';
import { createDefaultWorkspace } from '../../src/server/db/workspace';
import auth from '../../src/server/routes/auth';
import cfOauth from '../../src/server/routes/cf-oauth';
import dashboard from '../../src/server/routes/dashboard';
import settings from '../../src/server/routes/settings';
import budgetsRoute from '../../src/server/routes/budgets';

// End-to-end through the real Hono app: requests flow through routing,
// the auth middleware, the handlers, and a real-SQLite D1. Mirrors index.ts's
// route mounting (minus the static SPA, which needs the Workers asset binding).
function buildApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/auth', auth);
  app.route('/api/auth/cf', cfOauth);
  app.route('/api/dashboard', dashboard);
  app.route('/api/settings', settings);
  app.route('/api/budgets', budgetsRoute);
  app.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }));
  return app;
}

const SECRET = 'test-session-secret';

function makeEnv(db: TestD1): Env {
  return {
    DB: db.db,
    SESSION_SECRET: SECRET,
    CF_OAUTH_CLIENT_ID: 'test-client-id',
    CF_OAUTH_REDIRECT_URI: 'https://app.example.com/api/auth/cf/callback',
    CF_OAUTH_EXTRA_SCOPES: 'user-details.read',
    TOKEN_ENC_KEY: 'dGVzdC10b2tlbi1lbmNyeXB0aW9uLWtleS0zMmJ5dA==',
  } as unknown as Env;
}

async function sessionCookie(userId: string, email: string): Promise<string> {
  const token = await createSessionToken({ userId, email }, SECRET);
  return `session=${token}`;
}

describe('API e2e (app.request through real routing + D1)', () => {
  let d1: TestD1;
  let app: ReturnType<typeof buildApp>;
  let env: Env;

  beforeEach(() => {
    d1 = createTestD1();
    app = buildApp();
    env = makeEnv(d1);
  });

  afterEach(() => {
    d1.close();
  });

  it('GET /health returns ok', async () => {
    const res = await app.request('/health', undefined, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: '0.1.0' });
  });

  it('rejects unauthenticated dashboard and status requests with 401', async () => {
    const dash = await app.request('/api/dashboard', undefined, env);
    expect(dash.status).toBe(401);
    const status = await app.request('/api/auth/cf/status', undefined, env);
    expect(status.status).toBe(401);
  });

  it('GET /api/auth/cf/login redirects to the Cloudflare authorize URL with PKCE + state', async () => {
    const res = await app.request('/api/auth/cf/login', undefined, env);
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('https://dash.cloudflare.com/oauth2/auth')).toBe(true);

    const url = new URL(location);
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
    const scope = url.searchParams.get('scope') ?? '';
    expect(scope).toContain('account-analytics.read');
    expect(scope).toContain('user-details.read');

    // A signed state cookie is set so /callback can verify the round-trip.
    expect(res.headers.get('set-cookie') ?? '').toContain('cf_oauth=');
  });

  it('serves demo data for a signed-in user with a workspace but no connected account', async () => {
    const user = await createUser(d1.db, {
      id: 'user-a',
      email: 'a@example.com',
      name: 'A',
      picture: null,
    });
    await createDefaultWorkspace(d1.db, user.id, 'Personal');

    const res = await app.request(
      '/api/dashboard',
      { headers: { cookie: await sessionCookie(user.id, user.email) } },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summaries: unknown[]; freeTierStatus: unknown[] };
    // Demo data renders a single synthetic account summary.
    expect(Array.isArray(body.summaries)).toBe(true);
    expect(body.summaries.length).toBe(1);
    expect(Array.isArray(body.freeTierStatus)).toBe(true);
  });

  it('returns empty summaries for a signed-in user with no workspace yet', async () => {
    const user = await createUser(d1.db, {
      id: 'user-b',
      email: 'b@example.com',
      name: 'B',
      picture: null,
    });

    const res = await app.request(
      '/api/dashboard',
      { headers: { cookie: await sessionCookie(user.id, user.email) } },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summaries: unknown[] };
    expect(body.summaries).toEqual([]);
  });
});
