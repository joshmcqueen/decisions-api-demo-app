import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { assignedToMaya, Workflow } from './workflow.ts';
import { actionInput } from './workflow-http.ts';
import { Fault } from './workflow-db.ts';
import { trace } from './onsite-tracing.ts';

type Auth = {
  issuer: string;
  resource: string;
  subject: string;
  verify: (jwt: string) => Promise<{ sub?: string; scope?: unknown }>;
};
export function configuredOAuth(): Auth {
  function setting(key: string) {
    const v = process.env[key];
    if (!v) throw Error('Missing ' + key);
    return v;
  }
  function https(key: string) {
    const url = new URL(setting(key));
    if (url.protocol !== 'https:') throw Error(key + ' must use HTTPS');
    return url;
  }
  https('MCP_ISSUER');
  const issuer = setting('MCP_ISSUER'),
    resource = https('MCP_RESOURCE').href,
    subject = setting('MCP_MAYA_SUBJECT'),
    keys = createRemoteJWKSet(https('MCP_JWKS_URI'));
  return {
    issuer,
    resource,
    subject,
    verify: async (token) =>
      (
        await jwtVerify(token, keys, {
          issuer: setting('MCP_ISSUER'),
          audience: resource,
          algorithms: ['RS256', 'ES256'],
          requiredClaims: ['exp', 'sub'],
        })
      ).payload,
  };
}
const uri = 'ui://listing-review/case-v1.html',
  mime = 'text/html;profile=mcp-app';
export function reviewerMcp(flow: Workflow, auth: Auth | 'maya-demo' | 'maya-desktop') {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  if (auth === 'maya-desktop') {
    app.use((req, res, next) => {
      const peer = req.socket.remoteAddress;
      if (
        !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer ?? '') ||
        !['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname) ||
        Object.keys(req.headers).some(h => h === 'forwarded' || h.startsWith('x-forwarded-')) ||
        req.headers['sec-fetch-site'] === 'cross-site' ||
        (req.headers.origin !== undefined && req.headers.origin !== 'http://' + req.get('host'))
      ) return res.status(403).end();
      next();
    });
  } else if (typeof auth !== 'string') {
    const protectedUrl = new URL('/.well-known/oauth-protected-resource/mcp', auth.resource).href;
    app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (_req, res) =>
      res.json({
        resource: auth.resource,
        authorization_servers: [auth.issuer],
        scopes_supported: ['case:read', 'case:write'],
        bearer_methods_supported: ['header'],
      }),
    );
    app.post('/mcp', async (req, res, next) => {
      const jwt = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
      const principal = jwt ? await auth.verify(jwt).catch(() => null) : null;
      if (!principal || principal.sub !== auth.subject) {
        res.setHeader('WWW-Authenticate', 'Bearer resource_metadata="' + protectedUrl + '"');
        res.status(401).end();
        return;
      }
      const scopes = typeof principal.scope === 'string' ? principal.scope.split(' ') : [];
      if (!scopes.includes('case:read')) {
        res.status(403).end();
        return;
      }
      res.locals.canWrite = scopes.includes('case:write');
      next();
    });
  }
  app.post('/mcp', async (req, res) => {
    const canWrite = auth === 'maya-desktop' || res.locals.canWrite === true;
    const instructions = [
      'Role-play as Maya, the catalog reviewer for this synthetic demo.',
      typeof auth === 'string' ? 'Use list_cases to find your assigned cases.' : '',
      'Use get_case and get_evidence to explain the disputed claim. Cite the source references.',
      canWrite
        ? 'Show the prepared recommendation and any suggested correction text. When the reviewer explicitly asks to take that action, call submit_case_action using the case version, listing revision and brief ID they reviewed. Report the returned receipt. If the brief is stale, show the updated recommendation for confirmation.'
        : 'This connection has read access. The presenter confirms dispositions in Seller Studio.',
    ].filter(Boolean).join(' ');
    const server = new McpServer({ name: 'seller-listing-review', version: '1.1.0' }, { instructions });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const wrap = (name: string, id: string, fn: () => Record<string, unknown>) => {
      const start = Date.now();
      try {
        const c = flow.read(id, 'maya'),
          data = fn();
        trace(flow.store, 'mcp.' + name, start, {
          case_id: c.id,
          revision: c.revision,
          policy: c.finding.policy,
          route: typeof data.status === 'string' ? data.status : c.status,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data) }],
          structuredContent: data,
        };
      } catch (e) {
        let context = {};
        try {
          const c = flow.read(id, 'maya');
          context = { case_id: c.id, revision: c.revision, policy: c.finding.policy };
        } catch {
          /* Unauthorized IDs never enter traces. */
        }
        trace(flow.store, 'mcp.' + name, start, {
          ...context,
          error_class: e instanceof Fault ? 'http_' + e.status : 'invalid_request',
        });
        return {
          isError: true,
          structuredContent: { status: e instanceof Fault ? e.status : 503 },
          content: [
            { type: 'text' as const, text: e instanceof Fault ? e.message : 'Tool unavailable' },
          ],
        };
      }
    };
    if (typeof auth === 'string') {
      server.registerTool('list_cases', {
        description: 'List the synthetic cases assigned to Maya, including IDs for opening them.',
        inputSchema: {}, annotations: { readOnlyHint: true },
      }, () => {
        const cases = flow.store.cases().filter(assignedToMaya).map(c => ({
          case_id: c.id, sku: c.sku, source: c.source, status: c.status, report: c.report,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(cases) }], structuredContent: { cases } };
      });
    }
    server.registerResource('reviewer-card', uri, { mimeType: mime }, async () => ({
      contents: [
        {
          uri,
          mimeType: mime,
          text: readFileSync(new URL('./reviewer-card.html', import.meta.url), 'utf8'),
        },
      ],
    }));
    server.registerTool(
      'get_case',
      {
        description:
          'Open an assigned catalog case with its prepared brief, available commerce ontology trace, evidence references and current permissions.',
        inputSchema: { case_id: z.string().uuid() },
        annotations: { readOnlyHint: true },
        _meta: { ui: { resourceUri: uri }, 'openai/outputTemplate': uri },
      },
      ({ case_id }) =>
        wrap('get_case', case_id, () => {
          const c = flow.read(case_id, 'maya');
          return { ...c, actions: canWrite ? c.actions : [] };
        }),
    );
    server.registerTool(
      'get_evidence',
      {
        description: 'Inspect one evidence reference attached to this assigned case.',
        inputSchema: { case_id: z.string().uuid(), evidence_ref: z.string().max(200) },
        annotations: { readOnlyHint: true },
      },
      ({ case_id, evidence_ref }) =>
        wrap('get_evidence', case_id, () => {
          const item = flow.read(case_id, 'maya').evidence.find((e) => e.ref === evidence_ref);
          if (!item) throw new Fault(404, 'Evidence unavailable');
          return { ...item };
        }),
    );
    if (canWrite)
      server.registerTool(
        'submit_case_action',
        {
          description:
            'Record the explicitly confirmed disposition using version, revision, and brief.id from get_case. The seller receives the prepared correction text for send_correction. Reuse the same idempotency_key when retrying the same request.',
          inputSchema: actionInput.extend({ case_id: z.string().uuid() }),
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        ({ case_id, ...input }) =>
          wrap('submit_case_action', case_id, () => flow.act(case_id, 'maya', input)),
      );
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', (_req, res) => res.set('Allow', 'POST').sendStatus(405));
  return app;
}
