import { Router, type Request } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Workflow, type Actor } from './workflow.ts';
import { Fault, merchant } from './workflow-db.ts';
import { assets } from './catalog.ts';
import { describeGrant, approveGrant } from './presenter-oauth.ts';
import { policyState, shadowOverlay, activatePolicy } from './overlay-policy.ts';
import releases from '../eval/rehearsal-results.json' with { type: 'json' };

const text = z.string().trim().min(1).max(1000);
const rev = z.number().int().positive();
export const actionInput = z
  .object({
    action: z.enum(['send_correction', 'request_evidence', 'dismiss']),
    expected_case_version: rev,
    expected_listing_revision: rev,
    brief_id: z.string().uuid(),
    idempotency_key: z.string().min(1).max(120),
    rationale: text.optional(),
  })
  .strict();
export function router(flow: Workflow) {
  const api = Router(),
    sessions = new Map<string, { actor: Actor; expires: number }>();
  api.use((req, res, next) => {
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      return res.status(403).json({ error: 'Local presenter workspace only' });
    next();
  });
  api.post('/session', (req, res) => {
    const { role } = z
      .object({
        role: z.enum([
          'seller',
          'maya',
          'operations',
          'agent',
          'shopper',
          'auditor',
          'engineer',
          'policy',
          'steward',
        ]),
      })
      .parse(req.body);
    const token = randomBytes(32).toString('hex');
    for (const [key, value] of sessions) if (value.expires < Date.now()) sessions.delete(key);
    sessions.set(token, { actor: role, expires: Date.now() + 12 * 3600000 });
    res.cookie('onsite_' + role, token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api',
      maxAge: 12 * 3600000,
    });
    res.json({ role });
  });
  function actor(req: Request, ...roles: Actor[]) {
    const view = String(req.headers['x-onsite-view'] || 'seller');
    const token = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('onsite_' + view + '='))
      ?.split('=')[1];
    const s = token && sessions.get(token);
    if (!s || s.expires < Date.now()) throw new Fault(401, 'Choose a presenter role');
    if (roles.length && !roles.includes(s.actor))
      throw new Fault(403, 'This action requires another role');
    return s.actor;
  }
  function owned(req: Request, id: string) {
    actor(req, 'seller');
    const d = flow.store.draft(id);
    if (d.merchant !== merchant || ['silent', 'feed'].includes(id))
      throw new Fault(404, 'Draft unavailable');
    return d;
  }
  api.get('/workspace', (req, res) => {
    const role = actor(req);
    let cases = flow.store
      .cases()
      .filter(
        (c) =>
          role === 'auditor' ||
          (role === 'maya' && c.assigned === 'Maya' && c.merchant === merchant) ||
          (role === 'seller' && c.merchant === merchant && !c.twin),
      );
    if (role === 'maya')
      cases = cases.filter((c) => {
        try {
          flow.read(c.id, role);
          return true;
        } catch {
          return false;
        }
      });
    if (role === 'seller')
      cases = cases.map((c) => ({
        ...c,
        brief: null,
        actions: [],
        attempts: [],
        events: c.events.filter((e) => e.label !== 'Preparation requested'),
      }));
    const drafts =
      role === 'seller'
        ? flow.store
            .drafts()
            .filter((d) => d.merchant === merchant && !['silent', 'feed'].includes(d.id))
        : [];
    const configured = process.env.ONSITE_HANDOFF;
    const connected = ['mcp-read', 'mcp-write'].includes(configured ?? '');
    const plugin = process.env.ONSITE_PLUGIN_URL ?? '';
    if (role === 'maya')
      cases = cases.map((c) => {
        if (!c.brief || c.prep !== 'Ready' || flow.store.draft(c.draftId).revision !== c.revision)
          return c;
        const row = flow.store.db
          .prepare('SELECT url FROM prepared_chats WHERE case_id=? AND brief_id=? AND revision=?')
          .get(c.id, c.brief.id, c.revision);
        return row ? { ...c, preparedChatUrl: String(row.url) } : c;
      });
    res.json({
      role,
      drafts,
      cases,
      assets,
      policy: flow.store.policyId(),
      handoff: connected ? configured : 'brief',
      chatUrl:
        connected && /^https:\/\/chatgpt\.com\/plugins\/plugin_[a-zA-Z0-9_-]+$/.test(plugin)
          ? plugin
          : 'https://chatgpt.com/',
    });
  });
  api.get('/drafts/:id', (req, res) => {
    const d = owned(req, req.params.id);
    res.json({ draft: d, run: flow.store.lastRun(d.id, d.revision) });
  });
  api.patch('/drafts/:id', (req, res) => {
    owned(req, req.params.id);
    const { expectedRevision, ...edits } = z
      .object({
        expectedRevision: rev,
        title: text,
        bullets: z.array(text).length(3),
        imageId: text,
        placement: z.enum(['main', 'secondary']),
      })
      .strict()
      .parse(req.body);
    res.json(flow.save(req.params.id, expectedRevision, edits));
  });
  api.post('/drafts/:id/checks', async (req, res) => {
    owned(req, req.params.id);
    const { revision } = z.object({ revision: rev }).parse(req.body),
      controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    res.json(await flow.check(req.params.id, revision, controller.signal));
  });
  api.post('/drafts/:id/help', (req, res) => {
    owned(req, req.params.id);
    const { revision, check, question } = z
      .object({ revision: rev, check: text, question: text })
      .parse(req.body);
    res.json(flow.help(req.params.id, revision, check, question));
  });
  api.post('/reports', (req, res) => {
    actor(req, 'shopper');
    const { report } = z.object({ report: text }).parse(req.body);
    res.status(201).json({ id: flow.report('coffee', report).id });
  });
  api.post('/merchant/submissions', async (req, res) => {
    const who = actor(req, 'agent'),
      v = z
        .object({ idempotency_key: text, bullets: z.array(text).length(3) })
        .strict()
        .parse(req.body);
    res.json(await flow.submitFeed(v.idempotency_key, v.bullets, who));
  });
  api.post('/cases/:id/action', (req, res) =>
    res.json(flow.act(req.params.id, actor(req, 'maya'), actionInput.parse(req.body))),
  );
  api.post('/cases/:id/prepare', (req, res) =>
    res.json(flow.refresh(req.params.id, actor(req, 'maya'))),
  );
  api.post('/cases/:id/activity', (req, res) => {
    const who = actor(req, 'maya'),
      c = flow.read(req.params.id, who),
      at = Date.now();
    const { mode } = z.object({ mode: z.enum(['start', 'heartbeat', 'pause']) }).parse(req.body);
    if (c.status !== 'In review' && mode !== 'pause') return res.sendStatus(204);
    flow.store.tx(() => {
      const previous = flow.store.db
        .prepare('SELECT started FROM activity WHERE case_id=? AND actor=?')
        .get(c.id, who);
      const wasActive = Number(previous?.started ?? 0) > 0;
      if (mode === 'pause' && wasActive)
        flow.store.event(c, 'Maya', 'Review paused', 'Local review activity paused.');
      if (mode !== 'pause' && !wasActive)
        flow.store.event(c, 'Maya', 'Review started', 'Local review activity began.');
      flow.store.db
        .prepare(
          `INSERT INTO activity VALUES(?,?,?,?,0) ON CONFLICT(case_id,actor) DO UPDATE SET
      active_ms=active_ms+CASE WHEN started>0 THEN MIN(MAX(excluded.last_seen-last_seen,0),45000) ELSE 0 END,
      started=excluded.started,last_seen=excluded.last_seen`,
        )
        .run(c.id, who, mode === 'pause' ? 0 : at, at);
    });
    res.sendStatus(204);
  });
  api.get('/reviewer-grant/:key', (req, res) => {
    actor(req, 'maya');
    res.json(describeGrant(flow.store, req.params.key));
  });
  api.post('/reviewer-grant/:key', (req, res) => {
    actor(req, 'maya');
    const { allowWrite } = z.object({ allowWrite: z.boolean() }).strict().parse(req.body);
    res.json({ redirect: approveGrant(flow.store, req.params.key, allowWrite) });
  });
  api.get('/sources', (req, res) => {
    actor(req, 'steward');
    res.json(flow.store.drafts().filter((d) => !['silent', 'feed', 'refund'].includes(d.id)));
  });
  api.post('/sources/:id', async (req, res) => {
    actor(req, 'steward');
    const v = z
      .discriminatedUnion('kind', [
        z
          .object({
            kind: z.literal('fact'),
            expectedRevision: rev,
            field: text,
            value: z.string().max(500),
            basis: text,
          })
          .strict(),
        z.object({ kind: z.literal('approval'), expectedRevision: rev, basis: text }).strict(),
      ])
      .parse(req.body);
    const revised = flow.verifySource(req.params.id, v);
    const runs = await Promise.allSettled(revised.map((d) => flow.check(d.id, d.revision)));
    res.json({
      updated: revised.length,
      validated: runs.filter((r) => r.status === 'fulfilled').length,
    });
  });
  api.get('/policy', (req, res) => {
    actor(req, 'policy');
    res.json(policyState(flow));
  });
  api.post('/policy/shadow', async (req, res) => {
    actor(req, 'policy');
    await shadowOverlay(flow);
    res.json(policyState(flow));
  });
  api.post('/policy/activate', (req, res) => {
    actor(req, 'policy');
    const v = z.object({ expected: text, version: text, review: text }).strict().parse(req.body);
    res.json(activatePolicy(flow, v.expected, v.version, v.review));
  });
  api.get('/release', (req, res) => {
    actor(req, 'engineer');
    res.json(releases);
  });
  api.post('/operations/:id/assignment', (req, res) => {
    actor(req, 'operations');
    const v = z
      .object({ reviewer: z.enum(['Maya', 'Unassigned']), expectedVersion: rev })
      .strict()
      .parse(req.body);
    res.json(flow.assign(req.params.id, v.expectedVersion, v.reviewer));
  });
  api.get('/operations', (req, res) => {
    actor(req, 'operations');
    const cases = flow.store.cases().filter((c) => !c.twin);
    const rows = flow.store.db.prepare('SELECT case_id,active_ms FROM activity').all();
    const elapsed = (c: (typeof cases)[number], label: string) => {
      const end = c.events.find((e) => e.label === label);
      return end ? (Date.parse(end.at) - Date.parse(c.created)) / 60000 : null;
    };
    const average = (xs: (number | null)[]) => {
      const values = xs.filter((x): x is number => x !== null);
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    };
    const queueMinutes = average(cases.map((c) => elapsed(c, 'Review started')));
    const sellerWaitMinutes = average(
      cases
        .filter((c) => c.source === 'Seller request')
        .map(
          (c) =>
            elapsed(c, 'Correction requested') ??
            elapsed(c, 'Evidence requested') ??
            elapsed(c, 'Dismissed'),
        ),
    );
    res.json({
      queueMinutes,
      sellerWaitMinutes,
      cases: cases.length,
      assignments: cases
        .filter((c) => c.status === 'In review')
        .map(({ id, sku, category, assigned, version }) => ({
          id,
          sku,
          category,
          assigned,
          version,
        })),
      submittedCases: cases.filter((c) => c.source !== 'Shopper report').length,
      shopperReports: cases.filter((c) => c.source === 'Shopper report').length,
      activeMinutes:
        rows
          .filter((r) => cases.some((c) => c.id === r.case_id))
          .reduce((n, r) => n + Number(r.active_ms), 0) / 60000,
    });
  });
  api.use(
    (
      err: unknown,
      _req: Request,
      res: import('express').Response,
      _next: import('express').NextFunction,
    ) => {
      const status = err instanceof Fault ? err.status : err instanceof z.ZodError ? 400 : 503;
      res.status(status).json({
        error:
          err instanceof Fault
            ? err.message
            : status === 400
              ? 'Invalid request fields'
              : 'Operation unavailable. Please retry.',
      });
    },
  );
  return api;
}
