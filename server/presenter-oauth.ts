import { randomBytes } from 'node:crypto';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidScopeError,
  InvalidTokenError,
  UnsupportedGrantTypeError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { Store, Fault, digest } from './workflow-db.ts';

const token = () => randomBytes(32).toString('base64url');
const validScopes = ['case:read', 'case:write'];
type RequestData = {
  client: string;
  redirect: string;
  resource: string;
  scopes: string[];
  challenge: string;
  state?: string;
};
const callback = (uri: string) =>
  /^https:\/\/chatgpt\.com\/(?:connector\/oauth\/[A-Za-z0-9_-]+|connector_platform_oauth_redirect)$/.test(
    uri,
  );

function pending(store: Store, key: string) {
  const r = store.db
    .prepare('SELECT data FROM oauth_pending WHERE key=? AND expires>? AND code IS NULL')
    .get(digest(key), Date.now());
  if (!r) throw new Fault(404, 'Connection request expired. Start again in ChatGPT.');
  return JSON.parse(String(r.data)) as RequestData;
}
export function describeGrant(store: Store, key: string) {
  const g = pending(store, key);
  return { scopes: g.scopes, resource: g.resource, redirect: new URL(g.redirect).origin };
}
export function approveGrant(store: Store, key: string, allowWrite: boolean) {
  return store.tx(() => {
    const g = pending(store, key),
      code = token();
    g.scopes = g.scopes.filter((s) => s === 'case:read' || allowWrite);
    store.db
      .prepare('UPDATE oauth_pending SET code=?,data=?,expires=? WHERE key=?')
      .run(digest(code), JSON.stringify(g), Date.now() + 60000, digest(key));
    const target = new URL(g.redirect);
    target.searchParams.set('code', code);
    if (g.state) target.searchParams.set('state', g.state);
    return target.href;
  });
}
// Synthetic rehearsal identity. The only approval surface is the local Maya session.
// Token and client stores disappear when this dedicated listener stops.
export function presenterOAuth(store: Store, url: URL) {
  if (
    url.protocol !== 'https:' ||
    url.pathname !== '/mcp' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error('Expected a dedicated HTTPS /mcp resource');
  const resource = url.href,
    issuer = url.origin + '/',
    subject = 'onsite-maya';
  const clients = new Map<string, OAuthClientInformationFull>();
  const tokens = new Map<string, { scopes: string[]; client: string; exp: number }>();
  store.db.prepare('DELETE FROM oauth_pending').run();
  function approved(code: string, client: string) {
    const row = store.db
      .prepare('SELECT data FROM oauth_pending WHERE code=? AND expires>?')
      .get(digest(code), Date.now());
    if (!row) throw new InvalidGrantError('Invalid authorization code');
    const g = JSON.parse(String(row.data)) as RequestData;
    if (g.client !== client || g.resource !== resource)
      throw new InvalidGrantError('Invalid grant');
    return g;
  }
  const provider: OAuthServerProvider = {
    clientsStore: {
      getClient: (id) => clients.get(id),
      registerClient(metadata) {
        const client = metadata as OAuthClientInformationFull;
        if (
          !client.client_id ||
          !client.redirect_uris.length ||
          !client.redirect_uris.every(callback) ||
          clients.size >= 40
        )
          throw new InvalidClientMetadataError('This demo accepts only ChatGPT OAuth callbacks');
        clients.set(client.client_id, client);
        return client;
      },
    },
    async authorize(client, params: AuthorizationParams, res) {
      if (params.resource?.href !== resource || !callback(params.redirectUri))
        throw new InvalidGrantError('Invalid resource or callback');
      const scopes = params.scopes?.length ? params.scopes : ['case:read'];
      if (scopes.some((s) => !validScopes.includes(s)) || !scopes.includes('case:read'))
        throw new InvalidScopeError('Request case:read and optionally case:write');
      const key = token(),
        data: RequestData = {
          client: client.client_id,
          redirect: params.redirectUri,
          resource,
          scopes,
          challenge: params.codeChallenge,
          state: params.state,
        };
      store.db.prepare('DELETE FROM oauth_pending WHERE expires<=?').run(Date.now());
      store.db
        .prepare('INSERT INTO oauth_pending(key,data,expires) VALUES(?,?,?)')
        .run(digest(key), JSON.stringify(data), Date.now() + 5 * 60000);
      res.redirect('http://127.0.0.1:5173/reviewer-connect?request=' + key);
    },
    async challengeForAuthorizationCode(client, code) {
      return approved(code, client.client_id).challenge;
    },
    async exchangeAuthorizationCode(client, code, _verifier, redirect, requested) {
      return store.tx(() => {
        const g = approved(code, client.client_id);
        if (redirect !== g.redirect || requested?.href !== resource)
          throw new InvalidGrantError('Invalid callback or audience');
        store.db.prepare('DELETE FROM oauth_pending WHERE code=?').run(digest(code));
        const value = token();
        for (const [id, t] of tokens) if (t.exp <= Date.now()) tokens.delete(id);
        tokens.set(digest(value), {
          scopes: g.scopes,
          client: client.client_id,
          exp: Date.now() + 3600000,
        });
        return {
          access_token: value,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: g.scopes.join(' '),
        };
      });
    },
    async exchangeRefreshToken() {
      throw new UnsupportedGrantTypeError('Reconnect the local reviewer to renew');
    },
    async verifyAccessToken(value) {
      const t = tokens.get(digest(value));
      if (!t || t.exp <= Date.now()) throw new InvalidTokenError('Token expired');
      return {
        token: value,
        clientId: t.client,
        expiresAt: Math.floor(t.exp / 1000),
        resource: url,
        scopes: t.scopes,
      };
    },
    async revokeToken(client, input) {
      const key = digest(input.token);
      if (tokens.get(key)?.client === client.client_id) tokens.delete(key);
    },
  };
  return {
    router: mcpAuthRouter({
      provider,
      issuerUrl: new URL(issuer),
      resourceServerUrl: url,
      scopesSupported: validScopes,
    }),
    auth: {
      issuer,
      resource,
      subject,
      verify: async (value: string) => ({
        sub: subject,
        scope: (await provider.verifyAccessToken(value)).scopes.join(' '),
      }),
    },
  };
}
