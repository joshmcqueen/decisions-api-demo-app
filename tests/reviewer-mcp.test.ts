import { it, expect } from 'vitest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { generateKeyPair, SignJWT, jwtVerify } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { reviewerMcp } from '../server/reviewer-mcp.ts';
import { Workflow } from '../server/workflow.ts';
import { Store } from '../server/workflow-db.ts';
import { controlledAI } from '../eval/scenarios.ts';
import { createApp } from '../server/app.ts';

it('role-plays Maya over plain HTTP with no credentials on the Seller Studio endpoint', async () => {
  const store = new Store(':memory:');
  const workflow = new Workflow(store, controlledAI('mcp'));
  const coffee = workflow.report('coffee', 'Can it brew espresso?');
  const hidden = workflow.report('silent', 'Please check the manufacturer record.');
  await workflow.prepareNext();
  const server = createApp({ workflow }).listen(0, '127.0.0.1');
  const client = new Client({ name: 'maya-demo-test', version: '1' });
  try {
    await once(server, 'listening');
    const url = new URL('http://127.0.0.1:' + (server.address() as AddressInfo).port + '/mcp');
    await client.connect(new StreamableHTTPClientTransport(url));
    expect(client.getInstructions()).toContain('Role-play as Maya');
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['list_cases', 'get_case', 'get_evidence']);
    store.saveCase({ ...hidden, assigned: 'Unassigned' }, 'test-hidden');
    const queue = await client.callTool({ name: 'list_cases', arguments: {} });
    expect(queue.structuredContent).toEqual({ cases: [expect.objectContaining({ case_id: coffee.id })] });
    const opened = await client.callTool({ name: 'get_case', arguments: { case_id: coffee.id } });
    expect(opened.structuredContent).toMatchObject({ assigned: 'Maya', actions: [] });
    const evidence = await client.callTool({ name: 'get_evidence', arguments: {
      case_id: coffee.id, evidence_ref: coffee.evidence[1].ref,
    } });
    expect(evidence.structuredContent).toMatchObject({ text: expect.stringContaining('Not supported') });
    expect((await client.callTool({ name: 'get_case', arguments: { case_id: hidden.id } })).isError).toBe(true);
    const write = await client.callTool({ name: 'submit_case_action', arguments: {} }).catch(() => ({ isError: true }));
    expect(write.isError).toBe(true);
  } finally {
    await client.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.db.close();
  }
});

it('opens the card, reads linked evidence and records one authorized action over MCP', async () => {
  const store = new Store(':memory:'),
    flow = new Workflow(store, controlledAI('mcp')),
    c = flow.report('coffee', 'Does this make espresso?');
  await flow.prepareNext();
  const { privateKey, publicKey } = await generateKeyPair('ES256'),
    resource = 'https://review.example/mcp',
    issuer = 'https://id.example/';
  const app = reviewerMcp(flow, {
    resource,
    issuer,
    subject: 'maya-test',
    verify: async (t) =>
      (await jwtVerify(t, publicKey, { issuer, audience: resource, requiredClaims: ['exp'] }))
        .payload,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = new URL('http://127.0.0.1:' + (server.address() as AddressInfo).port + '/mcp');
  const clients: Client[] = [];
  async function connect(scope: string) {
    const token = await new SignJWT({ scope })
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject('maya-test')
      .setIssuer(issuer)
      .setAudience(resource)
      .setExpirationTime('5m')
      .sign(privateKey);
    const client = new Client({ name: 'rehearsal', version: '1' });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: 'Bearer ' + token } },
      }),
    );
    return client;
  }
  try {
    expect((await fetch(url, { method: 'POST' })).status).toBe(401);
    const read = await connect('case:read');
    expect((await read.listTools()).tools.map((t) => t.name)).toEqual(['get_case', 'get_evidence']);
    const ro = await read.callTool({ name: 'get_case', arguments: { case_id: c.id } });
    expect(ro.structuredContent).toMatchObject({
      id: c.id, actions: [], finding: { knowledgeTrace: {
        domain: { concept: 'EspressoBrewing', criterionId: 'bullet_facts' },
        sourceRef: c.evidence[1].ref, listingRef: c.evidence[0].ref,
      } },
    });
    const resources = await read.listResources(),
      card = await read.readResource({ uri: resources.resources[0].uri });
    expect(card.contents[0].mimeType).toBe('text/html;profile=mcp-app');
    const ok = await read.callTool({
      name: 'get_evidence',
      arguments: { case_id: c.id, evidence_ref: c.evidence[1].ref },
    });
    expect(ok.structuredContent).toMatchObject({ ref: c.evidence[1].ref });
    const detached = await read.callTool({
      name: 'get_evidence',
      arguments: { case_id: c.id, evidence_ref: 'another-case' },
    });
    expect(detached.isError).toBe(true);
    const writer = await connect('case:read case:write'),
      b = store.case(c.id).brief!;
    const request = {
      name: 'submit_case_action',
      arguments: {
        case_id: c.id,
        action: 'send_correction',
        expected_listing_revision: c.revision,
        expected_case_version: c.version,
        brief_id: b.id,
        idempotency_key: 'mcp-click',
      },
    };
    expect((await writer.callTool(request)).structuredContent).toMatchObject({
      status: 'Correction requested',
      actor: 'Maya',
    });
    await writer.callTool(request);
    expect(store.case(c.id).events.filter((e) => e.label === 'Correction requested')).toHaveLength(
      1,
    );
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    server.closeAllConnections();
    server.close();
    store.db.close();
  }
});

import { presenterOAuth, approveGrant } from '../server/presenter-oauth.ts';
import { createHash, randomBytes } from 'node:crypto';
import express from 'express';
it('binds a ChatGPT authorization code to local approval, resource, client and PKCE', async () => {
  const store = new Store(':memory:'),
    resource = new URL('https://review.example/mcp'),
    issuer = presenterOAuth(store, resource);
  const server = express().use(issuer.router).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  try {
    const redirect = 'https://chatgpt.com/connector/oauth/test-review';
    const register = await fetch(base + '/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [redirect], token_endpoint_auth_method: 'none' }),
    });
    expect(register.status).toBe(201);
    const { client_id } = await register.json(),
      verifier = randomBytes(32).toString('base64url'),
      state = 'browser-state';
    const params = new URLSearchParams({
      client_id,
      redirect_uri: redirect,
      state,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      scope: 'case:read case:write',
      response_type: 'code',
      resource: resource.href,
    });
    const auth = await fetch(base + '/authorize?' + params, { redirect: 'manual' });
    expect(auth.status).toBe(302);
    const key = new URL(auth.headers.get('location')!).searchParams.get('request')!;
    const callback = new URL(approveGrant(store, key, false));
    expect(callback.searchParams.get('state')).toBe(state);
    expect(() => approveGrant(store, key, true)).toThrow();
    const exchange = (v: string) =>
      fetch(base + '/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id,
          code: callback.searchParams.get('code')!,
          code_verifier: v,
          redirect_uri: redirect,
          resource: resource.href,
          grant_type: 'authorization_code',
        }),
      });
    expect((await exchange('wrong')).status).toBe(400);
    const accepted = await exchange(verifier);
    expect(accepted.status).toBe(200);
    const t = await accepted.json();
    expect(await issuer.auth.verify(t.access_token)).toEqual({
      sub: 'onsite-maya',
      scope: 'case:read',
    });
    expect((await exchange(verifier)).status).toBe(400);
  } finally {
    server.closeAllConnections();
    server.close();
    store.db.close();
  }
});
