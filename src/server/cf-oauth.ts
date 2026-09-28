import type { Env } from './types';
import type { CloudflareAccountInput } from './cloudflare-api';
import { decryptToken, encryptToken } from './crypto';
import {
  getCfToken,
  listAllCfTokens,
  setActiveAccount,
  upsertCfToken,
  type CfTokenRow,
} from './db/cf-tokens';

const AUTHORIZE_URL = 'https://dash.cloudflare.com/oauth2/auth';
const TOKEN_URL = 'https://dash.cloudflare.com/oauth2/token';

// Read-only scopes needed for usage/cost analytics + instance name resolution.
// (offline_access is not a valid Cloudflare scope; refresh tokens are issued
// with the authorization_code grant.)
export const OAUTH_SCOPES = [
  'account-analytics.read',
  'account-settings.read',
  'd1.read',
  'workers-kv-storage.read',
  'workers-scripts.read',
].join(' ');

// Works with both confidential clients (client_secret) and public PKCE clients
// (no secret); only the client id and an encryption key are mandatory.
export function oauthConfigured(env: Env): boolean {
  return Boolean(env.CF_OAUTH_CLIENT_ID && env.TOKEN_ENC_KEY);
}

function redirectUri(env: Env, requestUrl: string): string {
  if (env.CF_OAUTH_REDIRECT_URI) return env.CF_OAUTH_REDIRECT_URI;
  return new URL('/api/auth/cf/callback', requestUrl).toString();
}

// --- PKCE ---

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function codeChallenge(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  );
  return base64url(new Uint8Array(digest));
}

// Effective scope string: the built-in read scopes plus any extra space-
// separated scopes configured via env (e.g. "user-details.read" to enable the
// real verified email through /user). Kept in env so the exact scope string can
// be added — after verifying it in the OAuth client UI — without a code change
// or risking a broken authorize request from a wrong hardcoded guess.
export function effectiveScopes(env: Env): string {
  const extra = (env.CF_OAUTH_EXTRA_SCOPES || '').trim();
  return extra ? `${OAUTH_SCOPES} ${extra}` : OAUTH_SCOPES;
}

export async function buildAuthorizeUrl(
  env: Env,
  requestUrl: string,
  state: string,
  verifier: string
): Promise<string> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.CF_OAUTH_CLIENT_ID as string,
    redirect_uri: redirectUri(env, requestUrl),
    scope: effectiveScopes(env),
    state,
    code_challenge: await codeChallenge(verifier),
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

async function postToken(env: Env, body: URLSearchParams): Promise<TokenResponse> {
  body.set('client_id', env.CF_OAUTH_CLIENT_ID as string);
  if (env.CF_OAUTH_CLIENT_SECRET) body.set('client_secret', env.CF_OAUTH_CLIENT_SECRET);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Cloudflare token endpoint failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(
  env: Env,
  requestUrl: string,
  code: string,
  verifier: string
): Promise<TokenResponse> {
  return postToken(
    env,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(env, requestUrl),
      code_verifier: verifier,
    })
  );
}

async function refresh(env: Env, refreshToken: string): Promise<TokenResponse> {
  return postToken(
    env,
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
  );
}

export interface CfIdentity {
  id: string;
  email: string;
  name?: string;
}

// Establish a stable identity for the signed-in user. Prefers the REST /user
// endpoint (real verified email, needs the "User Details: Read" scope), then the
// OIDC userinfo endpoint, then an account-derived id so login still works on a
// client without any user scope.
export async function getIdentity(
  accessToken: string,
  accounts: Array<{ id: string; name: string }>
): Promise<CfIdentity> {
  // 1. REST /user — authoritative email when the token has User Details: Read.
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const json = (await res.json()) as {
        success?: boolean;
        result?: { id?: string; email?: string; first_name?: string; last_name?: string };
      };
      const u = json.result;
      if (json.success && u?.id && u.email) {
        const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || undefined;
        return { id: String(u.id), email: String(u.email), name };
      }
    }
  } catch {
    // fall through to userinfo
  }

  // 2. OIDC userinfo.
  try {
    const res = await fetch('https://dash.cloudflare.com/oauth2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const u = (await res.json()) as { sub?: string; id?: string; email?: string; name?: string };
      const id = u.sub || u.id;
      if (id) {
        return {
          id: String(id),
          email: u.email ? String(u.email) : `${id}@cloudflare.local`,
          name: u.name,
        };
      }
    }
  } catch {
    // fall through to account-derived identity
  }

  // 3. Account-derived fallback.
  const acct = accounts[0];
  const base = acct?.id || 'unknown';
  return { id: `acct-${base}`, email: `${base}@cloudflare.local`, name: acct?.name };
}

// Discover the Cloudflare accounts this token can access (first = default).
export async function listAccounts(
  accessToken: string
): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch('https://api.cloudflare.com/client/v4/accounts?per_page=50', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { result?: Array<{ id: string; name: string }> };
  return json.result ?? [];
}

// Persist a freshly-issued token set, recording every authorized account and
// preserving the active selection across token refreshes.
export async function storeConnection(
  env: Env,
  userId: string,
  tokens: TokenResponse
): Promise<void> {
  const accounts = await listAccounts(tokens.access_token);
  const existing = await getCfToken(env.DB, userId);
  let active = accounts[0];
  if (existing?.accountId) {
    const found = accounts.find((a) => a.id === existing.accountId);
    if (found) active = found;
  }
  const key = env.TOKEN_ENC_KEY as string;
  await upsertCfToken(env.DB, {
    userId,
    accountId: active?.id ?? null,
    accountName: active?.name ?? null,
    accessToken: await encryptToken(tokens.access_token, key),
    refreshToken: tokens.refresh_token ? await encryptToken(tokens.refresh_token, key) : null,
    expiresAt: tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : null,
    scope: tokens.scope ?? OAUTH_SCOPES,
    accounts: JSON.stringify(accounts),
  });
}

export interface AccountOption {
  id: string;
  name: string;
}

// List the accounts the user authorized, plus the active one.
export async function getAuthorizedAccounts(
  env: Env,
  userId: string
): Promise<{ accounts: AccountOption[]; activeId: string | null }> {
  const row = await getCfToken(env.DB, userId);
  if (!row) return { accounts: [], activeId: null };
  let accounts: AccountOption[] = [];
  try {
    accounts = row.accounts ? (JSON.parse(row.accounts) as AccountOption[]) : [];
  } catch {
    accounts = [];
  }
  // Fall back to a single entry if the list wasn't stored (older sessions).
  if (accounts.length === 0 && row.accountId) {
    accounts = [{ id: row.accountId, name: row.accountName || row.accountId }];
  }
  return { accounts, activeId: row.accountId };
}

// Switch the active account if it is one the user authorized.
export async function switchActiveAccount(
  env: Env,
  userId: string,
  accountId: string
): Promise<boolean> {
  const { accounts } = await getAuthorizedAccounts(env, userId);
  const match = accounts.find((a) => a.id === accountId);
  if (!match) return false;
  await setActiveAccount(env.DB, userId, match.id, match.name);
  return true;
}

export interface ConnectionStatus {
  connected: boolean;
  accountId?: string;
  accountName?: string;
}

export async function getConnectionStatus(env: Env, userId: string): Promise<ConnectionStatus> {
  const row = await getCfToken(env.DB, userId);
  if (!row) return { connected: false };
  return {
    connected: true,
    accountId: row.accountId ?? undefined,
    accountName: row.accountName ?? undefined,
  };
}

// A non-expired access token for a user's connection, refreshing (and
// re-persisting) when it is near expiry. Returns the (possibly stale) token if
// refresh fails, or null when nothing is stored.
async function freshAccessToken(env: Env, userId: string, row: CfTokenRow): Promise<string> {
  const key = env.TOKEN_ENC_KEY as string;
  let accessToken = await decryptToken(row.accessToken, key);
  const expired = row.expiresAt ? row.expiresAt < Math.floor(Date.now() / 1000) + 60 : false;
  if (expired && row.refreshToken) {
    try {
      const refreshed = await refresh(env, await decryptToken(row.refreshToken, key));
      await storeConnection(env, userId, refreshed);
      accessToken = refreshed.access_token;
    } catch (err) {
      // Refresh failed. Log the cause (otherwise expiry handling is a black
      // box) and re-read the row first: a concurrent request may have already
      // refreshed and rotated the token — its row beats our stale copy.
      console.error('Token refresh failed:', err instanceof Error ? err.message : String(err));
      const fresh = await getCfToken(env.DB, userId);
      if (fresh && fresh.accessToken !== row.accessToken) {
        try {
          accessToken = await decryptToken(fresh.accessToken, key);
        } catch {
          // keep the stale token
        }
      }
    }
  }
  return accessToken;
}

// Resolve the Cloudflare account to query for a user: their connected OAuth
// account (refreshing the token if expired), falling back to the env-configured
// account so the app keeps working before anyone connects.
export async function resolveCloudflareAccount(
  env: Env,
  userId: string | undefined
): Promise<CloudflareAccountInput | null> {
  // A specific signed-in user must only ever resolve to THEIR OWN connected
  // Cloudflare account. Never fall back to the env account for a given user, or
  // one tenant could see another tenant's (e.g. the operator's) cost data.
  if (userId) {
    if (!oauthConfigured(env)) return null;
    const row = await getCfToken(env.DB, userId);
    if (!row?.accountId) return null;
    const apiToken = await freshAccessToken(env, userId, row);
    return { accountId: row.accountId, apiToken, name: row.accountName || 'Cloudflare Account' };
  }

  // No user (scheduled / legacy single-tenant path): use the env-configured account.
  if (env.CF_ANALYTICS_TOKEN && env.CF_ACCOUNT_ID) {
    return {
      accountId: env.CF_ACCOUNT_ID,
      apiToken: env.CF_ANALYTICS_TOKEN,
      name: env.CF_ACCOUNT_NAME || 'Cloudflare Account',
    };
  }
  return null;
}

export interface ConnectedAccount {
  accountId: string;
  name: string;
  userId: string; // a user whose token can query this account
}

// Distinct Cloudflare accounts reachable across all connected users. A single
// account authorized by several users appears once, paired with one user whose
// token can query it. Used by the scheduled handler to fan out snapshots.
export async function listConnectedAccounts(env: Env): Promise<ConnectedAccount[]> {
  const rows = await listAllCfTokens(env.DB);
  const byAccount = new Map<string, ConnectedAccount>();
  for (const row of rows) {
    let accounts: Array<{ id: string; name: string }> = [];
    try {
      accounts = row.accounts ? (JSON.parse(row.accounts) as Array<{ id: string; name: string }>) : [];
    } catch {
      accounts = [];
    }
    if (accounts.length === 0 && row.accountId) {
      accounts = [{ id: row.accountId, name: row.accountName || row.accountId }];
    }
    for (const a of accounts) {
      if (a.id && !byAccount.has(a.id)) {
        byAccount.set(a.id, { accountId: a.id, name: a.name || a.id, userId: row.userId });
      }
    }
  }
  return [...byAccount.values()];
}

// Build a query-ready account input for a connected account, refreshing the
// representative user's token as needed. Null if their token vanished.
export async function accountInputForConnected(
  env: Env,
  acc: ConnectedAccount
): Promise<CloudflareAccountInput | null> {
  const row = await getCfToken(env.DB, acc.userId);
  if (!row) return null;
  const apiToken = await freshAccessToken(env, acc.userId, row);
  return { accountId: acc.accountId, apiToken, name: acc.name };
}
