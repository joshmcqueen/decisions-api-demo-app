import {
  type Action,
  type Draft,
  type Finding,
  type ReviewCase,
  type Route,
  type Validation,
  type Evidence,
  type ReviewBrief,
  actionLabels,
} from '../shared/workflow.ts';
import {
  Store,
  Fault,
  now,
  randomUUID,
  criterion,
  digest,
  evidence,
  merchant,
  overlayPolicy,
  overlayVersion,
} from './workflow-db.ts';
import { loadPrompts } from './questions.ts';
import { liveAI, preparationVersion, localeQuestion, type WorkflowAI } from './workflow-ai.ts';
import { trace } from './onsite-tracing.ts';
import { CHECK_IDS } from '../shared/domain.ts';

export type Actor =
  | 'seller'
  | 'maya'
  | 'agent'
  | 'shopper'
  | 'operations'
  | 'auditor'
  | 'engineer'
  | 'policy'
  | 'steward';
const active = (c: ReviewCase) => !['Dismissed', 'Revalidated'].includes(c.status);
const expertise = ['Electronics', 'Home & Kitchen'];
export function allowed(c: ReviewCase): Action[] {
  if (!active(c) || c.status !== 'In review') return [];
  return c.finding.route === 'red'
    ? ['send_correction', 'request_evidence', 'dismiss']
    : ['request_evidence', 'dismiss'];
}

export class Workflow {
  constructor(
    public store: Store,
    private ai: WorkflowAI = liveAI,
  ) {}
  private finding(id: string, route: Route, reason: string, refs: Evidence[]): Finding {
    const policy = this.store.policyId(),
      base = criterion(id);
    return {
      criterion:
        policy === overlayVersion && id === overlayPolicy.id
          ? { ...base, rule: overlayPolicy.rule }
          : base,
      policy,
      route,
      reason,
      evidence: refs,
    };
  }
  decidePolicy(d: Draft, prompts: ReturnType<typeof loadPrompts>) {
    return this.ai.decide(d, ['no_overlay'], prompts);
  }
  read(id: string, actor: Actor): ReviewCase {
    const c = this.store.case(id);
    if (
      (actor === 'seller' && c.merchant === merchant && !c.twin) ||
      actor === 'auditor' ||
      (actor === 'maya' &&
        c.merchant === merchant &&
        c.assigned === 'Maya' &&
        expertise.includes(c.category))
    )
      return c;
    throw new Fault(404, 'Case unavailable');
  }
  assign(id: string, expected: number, reviewer: 'Maya' | 'Unassigned') {
    return this.store.tx(() => {
      const c = this.store.case(id);
      if (c.merchant !== merchant || c.twin) throw new Fault(404, 'Case unavailable');
      if (c.status !== 'In review' || c.version !== expected)
        throw new Fault(409, 'Assignment changed. Reload the queue.');
      if (reviewer === 'Maya' && !expertise.includes(c.category))
        throw new Fault(400, 'Maya is not assigned to this product category.');
      if (c.assigned !== reviewer) {
        c.assigned = reviewer;
        c.version++;
        this.store.event(c, 'Operations lead', 'Assignment changed', reviewer);
        this.store.saveCase(c, '');
      }
      return { assigned: c.assigned, version: c.version };
    });
  }
  save(
    id: string,
    expected: number,
    edits: Pick<Draft, 'title' | 'bullets' | 'imageId' | 'placement'>,
  ) {
    return this.store.tx(() => {
      const d = this.store.draft(id);
      if (d.revision !== expected)
        throw new Fault(409, 'Draft changed. Reload the current revision.');
      if (!d.choices.includes(edits.imageId) || d.merchant !== merchant)
        throw new Fault(400, 'Asset is outside this product family');
      const next = {
        ...d,
        ...edits,
        assetRef: this.store.approval(d.sku, edits.imageId, edits.placement),
        revision: d.revision + 1,
      };
      this.store.saveDraft(next);
      for (const c of this.store.cases().filter((c) => c.draftId === id && active(c))) {
        this.store.event(c, 'Seller', 'Draft updated', 'Seller saved a new draft.', next.revision);
        if (c.status === 'In review') {
          c.prep = 'Stale brief';
          c.actions = [];
          c.version++;
          this.store.saveCase(c, '');
        }
      }
      return next;
    });
  }
  verifySource(
    id: string,
    input: ({ kind: 'fact'; field: string; value: string } | { kind: 'approval' }) & {
      expectedRevision: number;
      basis: string;
    },
  ) {
    return this.store.tx(() => {
      const original = this.store.draft(id);
      if (['silent', 'feed', 'refund'].includes(id)) throw new Fault(404, 'Source unavailable');
      if (original.revision !== input.expectedRevision)
        throw new Fault(409, 'Source changed. Reload the record.');
      let affected: Draft[], patch: Partial<Draft>;
      if (input.kind === 'fact') {
        if (
          !Object.hasOwn(original.facts, input.field) &&
          !(original.product === 'coffee' && input.field === 'Espresso function')
        )
          throw new Fault(400, 'Unknown source field');
        const facts = { ...original.facts };
        if (input.value.trim()) facts[input.field] = input.value.trim();
        else delete facts[input.field];
        const ref = 'pim/' + original.sku + '@' + digest(facts).slice(0, 8);
        this.store.put(ref, facts);
        affected = this.store
          .drafts()
          .filter((d) => d.pimRef === original.pimRef && d.id !== 'silent');
        patch = { facts, pimRef: ref };
      } else {
        const base = this.store.record<Record<string, unknown>>('asset/' + original.imageId + '@1');
        const asset = { ...base, sku: original.sku, placement: original.placement };
        const ref = 'asset/' + original.imageId + '@' + digest(asset).slice(0, 8);
        this.store.put(ref, asset);
        this.store.db
          .prepare(
            'INSERT INTO approvals VALUES(?,?,?,?) ON CONFLICT(sku,asset,placement) DO UPDATE SET ref=excluded.ref',
          )
          .run(original.sku, original.imageId, original.placement, ref);
        affected = this.store
          .drafts()
          .filter(
            (d) =>
              d.sku === original.sku &&
              d.imageId === original.imageId &&
              d.placement === original.placement &&
              d.id !== 'silent',
          );
        patch = { assetRef: ref };
      }
      this.store.put('verification/' + randomUUID(), {
        at: now(),
        actor: 'Data steward',
        basis: input.basis,
        source: patch.pimRef ?? patch.assetRef,
      });
      return affected.map((d) => {
        const next = { ...d, ...patch, revision: d.revision + 1 };
        this.store.saveDraft(next);
        for (const c of this.store.cases().filter((c) => c.draftId === d.id && active(c))) {
          this.store.event(c, 'Data steward', 'Evidence updated', input.basis, next.revision);
          if (c.status === 'In review') {
            c.prep = 'Stale brief';
            c.version++;
            c.actions = [];
            this.store.saveCase(c, '');
          }
        }
        return next;
      });
    });
  }
  async check(id: string, revision: number, signal?: AbortSignal) {
    const start = Date.now(),
      d = this.store.draft(id),
      policy = this.store.policyId(),
      prompts = this.store.promptsFor(policy);
    if (d.revision !== revision)
      throw new Fault(409, 'Draft changed. Recheck the current revision.');
    const refs = evidence(this.store, d),
      prior = this.store.lastRun(id, revision) ?? this.store.lastRun(id, revision - 1);
    const names = CHECK_IDS.filter(
      (n) => d.placement === 'main' || !['white_background', 'no_overlay'].includes(n),
    );
    const dependencies = new Map(
      names.map((n) => [
        n,
        digest([
          prompts.version,
          this.store.policyId(),
          n,
          d.pimRef,
          n === 'bullet_facts' ? d.bullets : null,
          ['title_facts', 'bullet_facts', 'image_product'].includes(n) ? d.title : null,
          ['image_product', 'white_background', 'no_overlay'].includes(n)
            ? [refs[2].ref, d.placement]
            : null,
        ]),
      ]),
    );
    const needed = names.filter(
      (n) =>
        !prior?.findings.some((f) => f.criterion.id === n && f.dependency === dependencies.get(n)),
    );
    const linked = this.store.cases().find((c) => c.draftId === id && active(c));
    const meta = {
      case_id: linked?.id,
      revision,
      policy: this.store.policyId(),
      prompt: prompts.version,
      evidence: refs.map((e) => e.ref),
    };
    let response: Awaited<ReturnType<WorkflowAI['decide']>> | undefined;
    if (needed.length) {
      try {
        response = await this.ai.decide(d, needed, prompts, signal);
        trace(this.store, 'model.decisions', start, {
          ...meta,
          model: response.model,
          usage: response.usage,
          estimated_usd: response.cost,
        });
      } catch (e) {
        trace(this.store, 'model.decisions', start, {
          ...meta,
          error_class: 'provider_or_invalid_output',
        });
        throw new Fault(503, 'Check unavailable. Retry validation.');
      }
    }
    const asset = this.store.record<{ sku: string | null; placement: string }>(refs[2].ref);
    const findings: Finding[] = names.map((n) => {
      const rule = criterion(n),
        selected = refs.filter((e) =>
          rule.evidence.includes(
            e.ref.split('/')[0] === 'listing' ? 'listing' : e.ref.split('/')[0],
          ),
        );
      const cached = prior?.findings.find(
        (f) => f.criterion.id === n && f.dependency === dependencies.get(n),
      );
      if (cached) return { ...cached, evidence: selected };
      const p = response!.answers[n];
      if (p === undefined) throw new Fault(503, 'Named check missing');
      const sibling = n === 'image_product' && asset.sku !== null && asset.sku !== d.sku;
      const missingCapability =
        n === 'bullet_facts' &&
        d.product === 'coffee' &&
        d.bullets.some((b) => /espresso/i.test(b)) &&
        !d.facts['Espresso function'];
      const route: Route =
        sibling || missingCapability
          ? 'yellow'
          : p && p.match >= rule.green
            ? 'green'
            : p && p.mismatch >= rule.red
              ? 'red'
              : 'yellow';
      return {
        ...this.finding(
          n,
          route,
          route === 'green'
            ? 'Evidence meets the configured threshold.'
            : route === 'red'
              ? rule.remedy
              : 'The evidence is inconclusive. Request clarification.',
          selected,
        ),
        dependency: dependencies.get(n),
        question: prompts.questions.find((q) => q.name === n)!.instructions,
        probabilities: p ?? undefined,
      };
    });
    const refund = d.bullets.find((b) => /\bfull refund\b/i.test(b));
    findings.push(
      this.finding(
        'bullet_refund',
        refund ? 'red' : 'green',
        refund
          ? 'Remove the promotional phrase “Full refund”.'
          : 'No matching promotional guarantee phrase.',
        [refs[0]],
      ),
    );
    const approved = asset.sku === d.sku && asset.placement === d.placement;
    findings.push(
      this.finding(
        'asset_approval',
        approved && d.placement === 'main' ? 'green' : 'yellow',
        d.placement !== 'main'
          ? 'The destination placement requires its own applicable image checks before clearance.'
          : approved
            ? 'Approved for this exact SKU and placement.'
            : 'Exact-SKU approval is missing for this placement.',
        [refs[1], refs[2]],
      ),
    );
    const route: Route = findings.some((f) => f.route === 'red')
      ? 'red'
      : findings.some((f) => f.route === 'yellow')
        ? 'yellow'
        : 'green';
    const run: Validation = {
      id: randomUUID(),
      revision,
      policy: this.store.policyId(),
      prompt: prompts.version,
      model: response?.model ?? prior!.model,
      route,
      findings,
    };
    this.store.tx(() => {
      if (this.store.policyId() !== policy || this.store.draft(id).revision !== revision)
        throw new Fault(409, 'Validation belongs to an older revision.');
      this.store.db
        .prepare('INSERT INTO runs VALUES(?,?,?,?)')
        .run(run.id, id, revision, JSON.stringify(run));
      if (route === 'green')
        for (const c of this.store
          .cases()
          .filter(
            (c) => c.draftId === id && c.status === 'Correction requested' && revision > c.revision,
          )) {
          trace(this.store, 'case.revalidation', start, { ...meta, case_id: c.id, route: 'green' });
          c.status = 'Revalidated';
          c.version++;
          this.store.event(c, 'Validator', c.status, 'Passed run ' + run.id, revision);
          this.store.saveCase(c, '');
        }
    });
    trace(this.store, 'validation.route', start, { ...meta, route });
    return run;
  }
  private open(
    d: Draft,
    source: ReviewCase['source'],
    report: string,
    f: Finding,
    issue: string,
    refs: Evidence[],
    attempts: ReviewCase['attempts'] = [],
  ) {
    const prior = this.store.db
      .prepare('SELECT id FROM cases WHERE issue=? ORDER BY rowid DESC LIMIT 1')
      .get(issue);
    if (prior) {
      const c = this.store.case(String(prior.id));
      if (active(c)) {
        if (attempts.length) {
          c.attempts = attempts;
          this.store.saveCase(c, issue);
        }
        return c;
      }
    }
    const c: ReviewCase = {
      id: randomUUID(),
      draftId: d.id,
      sku: d.sku,
      revision: d.revision,
      merchant: d.merchant,
      category: d.category,
      assigned: expertise.includes(d.category) ? 'Maya' : 'Unassigned',
      source,
      report,
      created: now(),
      status: 'In review',
      prep: 'Queued',
      version: 1,
      finding: f,
      evidence: refs,
      events: [],
      actions: [],
      brief: null,
      twin: d.id === 'silent',
      attempts,
    };
    this.store.saveCase(c, issue);
    this.store.put('intake/' + c.id, {
      at: c.created,
      report,
      revision: d.revision,
      evidence: refs,
      policy: f.policy,
    });
    this.store.event(c, source, 'Case opened', report);
    this.store.db.prepare("INSERT INTO jobs(case_id,state) VALUES(?,'queued')").run(c.id);
    return this.store.case(c.id);
  }
  help(id: string, revision: number, check: string, question: string) {
    return this.store.tx(() => {
      const d = this.store.draft(id),
        run = this.store.lastRun(id, revision),
        f = run?.findings.find((f) => f.criterion.id === check && f.route !== 'green');
      if (d.revision !== revision || !f || run?.policy !== this.store.policyId())
        throw new Fault(409, 'Recheck the current finding first.');
      return this.open(
        d,
        'Seller request',
        question,
        f,
        'seller/' + id + '/' + check,
        evidence(this.store, d),
      );
    });
  }
  private coffeeFinding(d: Draft, refs: Evidence[]) {
    const exclusion = d.facts['Espresso function']?.startsWith('Not supported');
    const claim = d.bullets.some((b) => /brews?[^.!?]*espresso/i.test(b));
    const contradiction = claim && exclusion;
    return this.finding(
      'bullet_facts',
      contradiction ? 'red' : 'yellow',
      contradiction
        ? 'Exact-SKU specification explicitly excludes espresso.'
        : !claim
          ? 'The current draft contains no affirmative espresso claim to correct.'
          : 'The source does not establish the alleged contradiction.',
      refs.slice(0, 2),
    );
  }
  report(id: string, report: string) {
    return this.store.tx(() => {
      const { revision } = this.store.record<{ revision: number }>('published/' + id),
        published = this.store.draft(id, revision),
        current = this.store.draft(id);
      const d = { ...published, facts: current.facts, pimRef: current.pimRef },
        refs = evidence(this.store, d);
      const f = this.coffeeFinding(d, refs);
      return this.open(
        d,
        'Shopper report',
        report,
        f,
        'shopper/' + id + '/' + revision + '/' + digest(report),
        refs,
      );
    });
  }
  async submitFeed(key: string, bullets: string[], who: Actor, signal?: AbortSignal) {
    if (who !== 'agent') throw new Fault(403, 'Merchant grant required');
    const grant = this.store.record<{
      draft: string;
      merchant: string;
      feed: string;
      agent: string;
      locale: string;
    }>('grant/merchant-demo');
    const d = this.store.draft(grant.draft);
    if (d.merchant !== grant.merchant) throw new Fault(403, 'Invalid merchant grant');
    const payload = { bullets, feed: grant.feed };
    const replay = this.store.db
      .prepare('SELECT fingerprint,data FROM receipts WHERE actor=? AND key=?')
      .get(grant.agent, key);
    if (replay) {
      if (replay.fingerprint !== digest(payload)) throw new Fault(409, 'Retry key conflict');
      return JSON.parse(String(replay.data));
    }
    const start = Date.now(),
      prompts = loadPrompts();
    let res: Awaited<ReturnType<WorkflowAI['decide']>>;
    try {
      res = await this.ai.decide(
        { ...d, bullets },
        ['bullet_locale'],
        prompts,
        signal,
        grant.locale,
      );
    } catch {
      trace(this.store, 'model.merchant_decisions', start, {
        revision: d.revision,
        policy: this.store.policyId(),
        error_class: 'provider_or_invalid_output',
      });
      throw new Fault(503, 'Check unavailable. Retry the submission.');
    }
    const p = res.answers.bullet_locale;
    const route: Route =
      p && p.mismatch >= criterion('bullet_locale').red
        ? 'red'
        : p && p.match >= criterion('bullet_locale').green
          ? 'green'
          : 'yellow';
    const result = this.store.tx(() =>
      this.store.replay(grant.agent, key, payload, () => {
        const issue = [d.merchant, d.id, grant.feed, 'bullet_locale'].join('/');
        const attempt = {
          at: now(),
          agent: grant.agent,
          merchant: grant.merchant,
          locale: grant.locale,
          bullets,
          route,
        };
        this.store.db
          .prepare('INSERT INTO attempts(issue,data) VALUES(?,?)')
          .run(issue, JSON.stringify(attempt));
        const history = this.store.db
          .prepare('SELECT data FROM attempts WHERE issue=? ORDER BY id')
          .all(issue)
          .map((r) => JSON.parse(String(r.data)));
        const lastPass = history.map((a) => a.route).lastIndexOf('green');
        let caseId: string | null = null;
        if (
          route === 'red' &&
          history.slice(lastPass + 1).filter((a) => a.route === 'red').length >= 2
        ) {
          const refs: Evidence[] = [
            {
              ref: 'attempt/' + digest(payload).slice(0, 12),
              label: 'Submitted bullets',
              text: bullets.join('\n'),
            },
            {
              ref: 'feed/US-English@1',
              label: 'Feed configuration',
              text: 'Target ' + grant.locale + ' · ' + grant.agent,
            },
          ];
          for (const ref of refs) this.store.put(ref.ref, ref);
          const f = {
            ...this.finding('bullet_locale', 'red', 'Repeated unresolved language mismatch.', refs),
            probabilities: p ?? undefined,
            question: localeQuestion,
          };
          caseId = this.open(
            d,
            'Merchant feed',
            'French copy resubmitted to the English feed.',
            f,
            issue,
            refs,
            history,
          ).id;
        }
        return {
          route,
          probabilities: p,
          policy: this.store.policyId(),
          status:
            route === 'red'
              ? 'Correction requested'
              : route === 'green'
                ? 'Accepted'
                : 'Needs evidence',
          caseId,
          attempt: history.length,
        };
      }),
    );
    trace(this.store, 'model.merchant_decisions', start, {
      case_id: result.caseId ?? undefined,
      revision: d.revision,
      prompt: digest([prompts.version, localeQuestion]),
      policy: this.store.policyId(),
      route,
      model: res.model,
      usage: res.usage,
      estimated_usd: res.cost,
    });
    return result;
  }
  async prepareNext() {
    const token = randomUUID();
    const job = this.store.tx(() => {
      const row = this.store.db
        .prepare(
          "SELECT case_id FROM jobs WHERE state='queued' OR (state='running' AND lease<?) ORDER BY rowid LIMIT 1",
        )
        .get(Date.now());
      if (!row) return null;
      const id = String(row.case_id);
      this.store.db
        .prepare(
          "UPDATE jobs SET state='running',attempts=attempts+1,lease=?,token=? WHERE case_id=?",
        )
        .run(Date.now() + 60000, token, id);
      return this.store.case(id);
    });
    if (!job) return false;
    const start = Date.now(),
      meta = {
        case_id: job.id,
        revision: job.revision,
        policy: job.finding.policy,
        prompt: preparationVersion(job),
        evidence: job.evidence.map((e) => e.ref),
      };
    try {
      trace(this.store, 'preparation.retrieve', start, meta);
      const options = allowed(job),
        res = await this.ai.prepare(job, options),
        b = res.result;
      if (
        !options.includes(b.recommendation) ||
        b.citations.some((ref) => !meta.evidence.includes(ref)) ||
        (job.source === 'Shopper report' &&
          !job.finding.evidence.every((e) => b.citations.includes(e.ref)))
      ) {
        trace(this.store, 'preparation.rejected', start, {
          ...meta,
          model: res.model,
          route: b.recommendation,
          error_class: 'unsupported_recommendation_or_citation',
        });
        throw Error('Unsupported recommendation or citation');
      }
      this.store.tx(() => {
        if (
          this.store.db.prepare('SELECT token FROM jobs WHERE case_id=?').get(job.id)?.token !==
          token
        )
          return;
        const current = this.store.case(job.id),
          stale =
            current.version !== job.version ||
            this.store.draft(job.draftId).revision !== job.revision;
        if (stale) {
          current.prep = 'Stale brief';
          current.actions = [];
        } else {
          current.brief = {
            ...b,
            id: randomUUID(),
            policy: job.finding.policy,
            model: res.model,
            prompt: preparationVersion(job),
            revision: job.revision,
            preparedAt: now(),
          };
          current.actions = options;
          current.prep = 'Ready';
          this.store.put('brief/' + current.brief.id, {
            ...current.brief,
            caseId: current.id,
            dependencies: meta.evidence,
          });
        }
        this.store.saveCase(current, '');
        this.store.db.prepare("UPDATE jobs SET state='done' WHERE case_id=?").run(job.id);
      });
      trace(this.store, 'model.prepare', start, {
        ...meta,
        route: b.recommendation,
        model: res.model,
        usage: res.usage,
        estimated_usd: res.cost,
      });
    } catch {
      this.store.tx(() => {
        const row = this.store.db
          .prepare('SELECT attempts,token FROM jobs WHERE case_id=?')
          .get(job.id);
        if (row?.token !== token) return;
        const retry = Number(row.attempts) < 2;
        const c = this.store.case(job.id);
        c.prep = retry ? 'Retrying' : 'Preparation failed';
        this.store.saveCase(c, '');
        this.store.db
          .prepare('UPDATE jobs SET state=? WHERE case_id=?')
          .run(retry ? 'queued' : 'failed', c.id);
      });
      trace(this.store, 'model.prepare', start, {
        ...meta,
        error_class: 'invalid_or_unavailable_preparation',
      });
    }
    return true;
  }
  refresh(id: string, actor: Actor) {
    return this.store.tx(() => {
      const c = this.read(id, actor);
      if (actor !== 'maya' || c.status !== 'In review')
        throw new Fault(403, 'Case unavailable for preparation');
      const d = this.store.draft(c.draftId);
      if (
        d.revision === c.revision &&
        c.finding.policy === this.store.policyId() &&
        (['Queued', 'Retrying'].includes(c.prep) ||
          (c.prep === 'Ready' && c.brief?.prompt === preparationVersion(c)))
      )
        return c;
      if (d.revision !== c.revision || c.finding.policy !== this.store.policyId()) {
        const run = this.store.lastRun(d.id, d.revision),
          f = run?.findings.find((f) => f.criterion.id === c.finding.criterion.id);
        if (!f || run?.policy !== this.store.policyId())
          throw new Fault(409, 'Revalidate the current draft before preparing a new brief.');
        c.evidence = evidence(this.store, d);
        c.revision = d.revision;
        c.finding = c.source === 'Shopper report' ? this.coffeeFinding(d, c.evidence) : f;
        if (c.source === 'Shopper report') {
          const published = this.store.record<{ revision: number }>('published/' + d.id);
          if (published.revision !== d.revision)
            c.evidence.push({
              ...evidence(this.store, this.store.draft(d.id, published.revision))[0],
              label: 'Original published listing',
            });
        }
      }
      c.version++;
      c.actions = [];
      c.brief = null;
      c.prep = 'Queued';
      this.store.saveCase(c, '');
      this.store.db
        .prepare("UPDATE jobs SET state='queued',attempts=0,token=NULL WHERE case_id=?")
        .run(id);
      this.store.event(c, 'Maya', 'Preparation requested', 'Current case snapshot');
      return c;
    });
  }
  act(
    id: string,
    actor: Actor,
    input: {
      action: Action;
      expected_case_version: number;
      expected_listing_revision: number;
      brief_id: string;
      idempotency_key: string;
      rationale?: string;
    },
  ) {
    return this.store.tx(() => {
      const c = this.read(id, actor);
      if (actor !== 'maya') throw new Fault(403, 'Assigned reviewer required');
      return this.store.replay(actor, input.idempotency_key, { id, ...input }, () => {
        if (
          c.brief?.prompt !== preparationVersion(c) ||
          c.version !== input.expected_case_version ||
          this.store.draft(c.draftId).revision !== input.expected_listing_revision ||
          c.revision !== input.expected_listing_revision ||
          c.brief?.id !== input.brief_id ||
          c.prep !== 'Ready' ||
          c.finding.policy !== this.store.policyId()
        )
          throw new Fault(409, 'This brief is stale. Reload the current case.');
        if (!allowed(c).includes(input.action))
          throw new Fault(403, 'Independent evidence does not authorize this disposition.');
        if (input.action !== c.brief.recommendation && !input.rationale?.trim())
          throw new Fault(400, 'Record your reason for choosing a different disposition.');
        const at = Date.now();
        this.store.db
          .prepare(
            'UPDATE activity SET active_ms=active_ms+MIN(MAX(?-last_seen,0),45000),started=0,last_seen=? WHERE case_id=? AND actor=? AND started>0',
          )
          .run(at, at, c.id, actor);
        c.status = {
          send_correction: 'Correction requested',
          request_evidence: 'Evidence requested',
          dismiss: 'Dismissed',
        }[input.action];
        c.version++;
        c.actions = [];
        const detail = JSON.stringify({
          caseId: c.id,
          actor: 'Maya',
          listingRevision: c.revision,
          policy: c.finding.policy,
          brief: c.brief.id,
          action: actionLabels[input.action],
          rationale: input.rationale || c.brief.rationale,
          citations: c.brief.citations,
          suggestedText: input.action === 'send_correction' ? c.brief.suggestedText : undefined,
        });
        this.store.event(c, 'Maya', c.status, detail);
        this.store.saveCase(c, '');
        this.store.put('notification/' + id + '@' + c.version, {
          merchant: c.merchant,
          caseId: id,
          revision: c.revision,
          status: c.status,
          detail,
          at: now(),
        });
        trace(this.store, 'case.disposition', Date.now(), {
          case_id: id,
          revision: c.revision,
          route: c.status,
          policy: c.finding.policy,
          evidence: c.brief.citations,
        });
        return {
          caseId: id,
          status: c.status,
          version: c.version,
          revision: c.revision,
          policy: c.finding.policy,
          actor: 'Maya',
          briefId: c.brief.id,
        };
      });
    });
  }
}
