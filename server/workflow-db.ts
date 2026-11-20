import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { products, assets, fixtures } from './catalog.ts';
import type { Draft, Evidence, Criterion, ReviewCase, Validation } from '../shared/workflow.ts';
import policy from '../policy/us-demo.json' with { type: 'json' };

import overlayChange from '../policy/overlay-clarification.json' with { type: 'json' };
import { loadPrompts } from './questions.ts';
export const overlayPolicy = overlayChange;
export const policyVersion = policy.version + '-' + digest(policy).slice(0, 8);
export const overlayVersion = policyVersion + '+' + digest(overlayChange).slice(0, 8);
export const criteria: Criterion[] = policy.criteria;
export function criterion(id: string) {
  const item = criteria.find((c) => c.id === id);
  if (!item) throw Error('Unknown criterion');
  return item;
}
export function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export class Fault extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const now = () => new Date().toISOString();
export const merchant = 'Cedar Market';
export const databasePath = () => resolve(process.env.ONSITE_DB || 'tmp/onsite/rehearsal.sqlite');
export class Store {
  db: DatabaseSync;
  constructor(file = databasePath()) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS revisions(id TEXT, revision INTEGER, data TEXT NOT NULL, PRIMARY KEY(id,revision));
      CREATE TABLE IF NOT EXISTS records(ref TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY, issue TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, draft TEXT, revision INTEGER, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, case_id TEXT, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts(actor TEXT, key TEXT, fingerprint TEXT, data TEXT, PRIMARY KEY(actor,key));
      CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY, issue TEXT, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(case_id TEXT PRIMARY KEY, state TEXT, attempts INTEGER DEFAULT 0, lease INTEGER DEFAULT 0, token TEXT);
      CREATE TABLE IF NOT EXISTS traces(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_pending(key TEXT PRIMARY KEY,data TEXT,expires INTEGER,code TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS approvals(sku TEXT, asset TEXT, placement TEXT, ref TEXT, PRIMARY KEY(sku,asset,placement));
      CREATE TABLE IF NOT EXISTS policy_events(id INTEGER PRIMARY KEY, version TEXT, at TEXT, actor TEXT, review TEXT);
      CREATE TABLE IF NOT EXISTS prepared_chats(case_id TEXT, brief_id TEXT, revision INTEGER, url TEXT NOT NULL, PRIMARY KEY(case_id,brief_id,revision));
      CREATE TABLE IF NOT EXISTS activity(case_id TEXT, actor TEXT, started INTEGER, last_seen INTEGER, active_ms INTEGER DEFAULT 0, PRIMARY KEY(case_id,actor));`);
    this.tx(() => this.seedDrafts());
  }
  policyId() {
    const row = this.db.prepare('SELECT version FROM policy_events ORDER BY id DESC LIMIT 1').get();
    return row?.version === overlayVersion ? overlayVersion : policyVersion;
  }
  promptsFor(version: string, base = loadPrompts()) {
    if (version !== overlayVersion) return base;
    const questions = base.questions.map((q) =>
      q.name === 'no_overlay' ? { ...q, instructions: overlayChange.question } : q,
    );
    return { ...base, questions, version: digest([base.version, overlayChange.question]) };
  }
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  record<T>(ref: string): T {
    const row = this.db.prepare('SELECT data FROM records WHERE ref=?').get(ref);
    if (!row) throw new Fault(404, 'Evidence unavailable');
    return JSON.parse(String(row.data));
  }
  put(ref: string, data: unknown) {
    this.db.prepare('INSERT OR IGNORE INTO records VALUES(?,?)').run(ref, JSON.stringify(data));
  }
  approval(sku: string, asset: string, placement: string) {
    const row = this.db
      .prepare('SELECT ref FROM approvals WHERE sku=? AND asset=? AND placement=?')
      .get(sku, asset, placement);
    return row ? String(row.ref) : 'asset/' + asset + '@1';
  }
  draft(id: string, rev?: number): Draft {
    const row =
      rev === undefined
        ? this.db
            .prepare('SELECT data FROM revisions WHERE id=? ORDER BY revision DESC LIMIT 1')
            .get(id)
        : this.db.prepare('SELECT data FROM revisions WHERE id=? AND revision=?').get(id, rev);
    if (!row) throw new Fault(404, 'Draft unavailable');
    return JSON.parse(String(row.data));
  }
  drafts(): Draft[] {
    return this.db
      .prepare('SELECT DISTINCT id FROM revisions ORDER BY rowid')
      .all()
      .map((r) => this.draft(String(r.id)));
  }
  saveDraft(d: Draft) {
    this.db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(d.id, d.revision, JSON.stringify(d));
  }
  saveCase(c: ReviewCase, issue: string) {
    this.db
      .prepare('INSERT INTO cases VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(c.id, issue, JSON.stringify({ ...c, events: [] }));
  }
  case(id: string): ReviewCase {
    const row = this.db.prepare('SELECT data FROM cases WHERE id=?').get(id);
    if (!row) throw new Fault(404, 'Case unavailable');
    const c = JSON.parse(String(row.data));
    if (c.status === 'In review' && c.finding.policy !== this.policyId()) {
      c.prep = 'Stale brief';
      c.actions = [];
    }
    c.events = this.db
      .prepare('SELECT data FROM events WHERE case_id=? ORDER BY id')
      .all(id)
      .map((row) => JSON.parse(String(row.data)));
    return c;
  }
  cases() {
    return this.db
      .prepare('SELECT id FROM cases ORDER BY rowid DESC')
      .all()
      .map((r) => this.case(String(r.id)));
  }
  event(c: ReviewCase, actor: string, label: string, detail: string, revision = c.revision) {
    this.db
      .prepare('INSERT INTO events(case_id,data) VALUES(?,?)')
      .run(
        c.id,
        JSON.stringify({ at: now(), actor, label, revision, policy: c.finding.policy, detail }),
      );
  }
  lastRun(id: string, rev: number): Validation | undefined {
    const row = this.db
      .prepare('SELECT data FROM runs WHERE draft=? AND revision=? ORDER BY rowid DESC LIMIT 1')
      .get(id, rev);
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  replay<T>(actor: string, key: string, payload: unknown, fn: () => T): T {
    const hash = digest(payload);
    const row = this.db.prepare('SELECT * FROM receipts WHERE actor=? AND key=?').get(actor, key);
    if (row) {
      if (row.fingerprint !== hash)
        throw new Fault(409, 'Retry key was used for a different operation');
      return JSON.parse(String(row.data));
    }
    const result = fn();
    this.db
      .prepare('INSERT INTO receipts VALUES(?,?,?,?)')
      .run(actor, key, hash, JSON.stringify(result));
    return result;
  }
  private seedDrafts() {
    this.put('policy/' + policyVersion, policy);
    this.put('policy/' + overlayVersion, {
      ...policy,
      version: overlayVersion,
      criteria: criteria.map((c) =>
        c.id === overlayChange.id ? { ...c, rule: overlayChange.rule } : c,
      ),
    });
    this.put('grant/merchant-demo', {
      agent: 'Cedar Feed Agent',
      merchant,
      feed: 'US-English',
      locale: 'en-US',
      draft: 'feed',
    });
    for (const [id, productId] of [
      ['headphones', 'headphones'],
      ['plush', 'plush'],
      ['sibling', 'headphones'],
      ['coffee', 'coffee'],
      ['silent', 'coffee'],
      ['refund', 'coffee'],
      ['feed', 'headphones'],
    ]) {
      if (this.db.prepare('SELECT 1 FROM revisions WHERE id=?').get(id)) continue;
      const p = products.find((p) => p.id === productId)!;
      const facts = { ...p.facts };
      if (productId === 'coffee') facts['Brewing method'] = 'Filter-basket drip brewing';
      if (id === 'silent') delete facts['Espresso function'];
      if (id === 'sibling') facts.Color = 'Graphite';
      const sku = id === 'sibling' ? 'FORM-H01-GPH' : p.sku;
      const pimRef = 'pim/' + sku + '@' + digest(facts).slice(0, 8);
      const fixture = fixtures.find(
        (f) =>
          f.productId === p.id &&
          f.variant === (['plush', 'coffee', 'silent'].includes(id) ? 'attention' : 'consistent'),
      )!;
      const d: Draft = {
        ...fixture.listing,
        bullets: [...fixture.listing.bullets],
        id,
        merchant,
        product: p.id,
        name: p.name,
        category: p.category,
        sku,
        revision: 1,
        placement: 'main',
        facts,
        pimRef,
        choices: p.imageIds,
      };
      if (id === 'sibling') {
        d.title = d.title.replace('Matte Black', 'Graphite');
        d.bullets = d.bullets.map((b) => b.replace('matte-black', 'graphite'));
        d.choices = ['headphones-black'];
      }
      if (id === 'refund') d.bullets[0] = 'Full refund if you change your mind';
      this.put(pimRef, facts);
      this.saveDraft(d);
      if (id === 'coffee' || id === 'silent') this.put('published/' + id, { revision: 1 });
    }
    for (const a of assets) {
      const p = products.find((p) => p.id === a.productId)!;
      const approved = a.id === p.thumbnail;
      const imageHash = createHash('sha256')
        .update(readFileSync(resolve('output/imagegen', a.file)))
        .digest('hex');
      this.put('asset/' + a.id + '@1', {
        sku: approved ? p.sku : null,
        placement: 'main',
        imageHash,
        file: a.file,
      });
    }
  }
}
export function evidence(store: Store, d: Draft): Evidence[] {
  const assetRef = d.assetRef ?? 'asset/' + d.imageId + '@1';
  const asset = store.record<{
    file: string;
    sku: string | null;
    placement: string;
    imageHash: string;
  }>(assetRef);
  return [
    {
      ref: 'listing/' + d.id + '@' + d.revision,
      label: 'Listing revision ' + d.revision,
      text: [d.title, ...d.bullets].join('\n'),
    },
    {
      ref: d.pimRef,
      label: 'Manufacturer record · ' + d.sku,
      text: Object.entries(d.facts)
        .map(([k, v]) => k + ': ' + v)
        .join('\n'),
    },
    {
      ref: assetRef,
      label: 'Digital asset library · ' + d.placement,
      text: asset.sku
        ? 'Approved for ' + asset.sku + ' / ' + asset.placement
        : 'Candidate photo · no exact-variant approval',
      image: '/products/' + asset.file,
    },
  ];
}
export { randomUUID };
