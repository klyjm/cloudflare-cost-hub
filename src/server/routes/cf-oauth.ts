import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import type { Env } from '../types';
import { createSessionToken, getSession, setSessionCookie } from '../auth';
import { createUser, findUserByEmail } from '../db/user';
import { createDefaultWorkspace } from '../db/workspace';
import { findWorkspacesByUserId } from '../db/workspace';
import { deleteCfToken } from '../db/cf-tokens';
import {
  buildAuthorizeUrl,
  exchangeCode,
  getAuthorizedAccounts,
  getConnectionStatus,
  getIdentity,
  listAccounts,
  oauthConfigured,
  randomVerifier,
  storeConnection,
  switchActiveAccount,
} from '../cf-oauth';

const STATE_COOKIE = 'cf_oauth';
const STATE_TTL = 600; // 10 minutes

const cf = new Hono<{ Bindings: Env }>();

async function signState(
  payload: { state: string; verifier: string },
  secret: string
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + STATE_TTL)
    .sign(new TextEncoder().encode(secret));
}

async function readState(
  token: string,
  secret: string
): Promise<{ state: string; verifier: string } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    if (!payload.state || !payload.verifier) return null;
    return { state: String(payload.state), verifier: String(payload.verifier) };
  } catch {
    return null;
  }
}

function cookieHeader(value: string, maxAge: number, secure: boolean): string {
  return `${STATE_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${
    secure ? '; Secure' : ''
  }`;
}

// Self-host allowlist: when ALLOWED_CF_USERS is set (comma-separated Cloudflare
// user ids / login emails), only those identities may sign in. Empty/unset
// keeps upstream's open registration.
function isAllowed(env: Env, identity: { id: string; email: string }): boolean {
  const raw = (env.ALLOWED_CF_USERS || '').trim();
  if (!raw) return true;
  const allowed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return (
    allowed.includes(identity.id.toLowerCase()) ||
    allowed.includes(identity.email.toLowerCase())
  );
}

// Primary login: redirect the user to Cloudflare to authorize. No prior app
// session is required — this IS the sign-in.
cf.get('/login', async (c) => {
  if (!oauthConfigured(c.env)) {
    return c.text('Cloudflare sign-in is not configured on this server.', 400);
  }
  const state = crypto.randomUUID();
  const verifier = randomVerifier();
  const cookie = await signState({ state, verifier }, c.env.SESSION_SECRET);
  const secure = c.req.url.startsWith('https');
  c.header('set-cookie', cookieHeader(cookie, STATE_TTL, secure));
  const url = await buildAuthorizeUrl(c.env, c.req.url, state, verifier);
  return c.redirect(url);
});

cf.get('/callback', async (c) => {
  const secure = c.req.url.startsWith('https');
  try {
    const code = c.req.query('code');
    const returnedState = c.req.query('state');
    const cookie = c.req.header('cookie') || '';
    const match = cookie.match(new RegExp(`${STATE_COOKIE}=([^;]+)`));
    const saved = match ? await readState(match[1], c.env.SESSION_SECRET) : null;

    // Always clear the state cookie.
    c.header('set-cookie', cookieHeader('', 0, secure));

    if (!code || !saved || saved.state !== returnedState) {
      return c.redirect('/?login=error');
    }

    const tokens = await exchangeCode(c.env, c.req.url, code, saved.verifier);
    const accounts = await listAccounts(tokens.access_token);
    const identity = await getIdentity(tokens.access_token, accounts);

    // Reject identities that are not on the self-host allowlist (no user row,
    // no session, no token storage).
    if (!isAllowed(c.env, identity)) {
      console.error('CF OAuth sign-in rejected by allowlist:', identity.id);
      return c.redirect('/?login=denied');
    }

    // Find or create the app user for this Cloudflare identity.
    let user = await findUserByEmail(c.env.DB, identity.email);
    if (!user) {
      user = await createUser(c.env.DB, {
        id: identity.id,
        email: identity.email,
        name: identity.name || null,
        picture: null,
      });
    }
    const workspaces = await findWorkspacesByUserId(c.env.DB, user.id);
    if (workspaces.length === 0) {
      await createDefaultWorkspace(c.env.DB, user.id, 'Personal');
    }

    // Issue the app session and persist the encrypted Cloudflare tokens.
    const sessionToken = await createSessionToken(
      { userId: user.id, email: user.email },
      c.env.SESSION_SECRET
    );
    setSessionCookie(c, sessionToken);
    await storeConnection(c.env, user.id, tokens);

    return c.redirect('/');
  } catch (err) {
    console.error('CF OAuth callback failed:', err instanceof Error ? err.message : String(err));
    return c.redirect('/?login=error');
  }
});

cf.post('/disconnect', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  await deleteCfToken(c.env.DB, session.userId);
  return c.json({ ok: true });
});

cf.get('/status', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const status = await getConnectionStatus(c.env, session.userId);
  return c.json({ ...status, oauthAvailable: oauthConfigured(c.env) });
});

// List the accounts the user authorized + the active one (for the switcher).
cf.get('/accounts', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  return c.json(await getAuthorizedAccounts(c.env, session.userId));
});

// Switch the active account.
cf.post('/account', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { accountId?: string };
  if (!body.accountId) return c.json({ error: 'accountId required' }, 400);
  const ok = await switchActiveAccount(c.env, session.userId, body.accountId);
  return ok ? c.json({ ok: true }) : c.json({ error: 'Account not authorized' }, 400);
});

export default cf;
