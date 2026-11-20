import { Store, Fault, policyVersion, digest } from '../server/workflow-db.ts';
import { Workflow, type Actor } from '../server/workflow.ts';
import { liveAI, type WorkflowAI } from '../server/workflow-ai.ts';
import { shopperReport, frenchBullets } from '../server/onsite-runtime.ts';
import type { Action, ReviewCase } from '../shared/workflow.ts';
import { flushTraces } from '../server/onsite-tracing.ts';

export const labels = {
  valid: 'green',
  wrong_color: 'red',
  corrected: 'green',
  overlay: 'red',
  integral_logo: 'green',
  ambiguous_mark: 'yellow',
  secondary: 'skipped',
  refund: 'red',
  sibling: 'yellow',
  explicit: 'send_correction',
  silent: 'request_evidence',
  merchant: 'one_case',
  stale: '409',
  unauthorized: '404',
  detached: 'Preparation failed',
  outage: 'unavailable',
  closed: 'Revalidated',
};
export type Scenario = keyof typeof labels;
// Controlled observations for contract tests. These values never enter the production provider.
export function controlledAI(scenario: string): WorkflowAI {
  return {
    async decide(d, names) {
      if (scenario === 'outage') throw Error('Unavailable');
      const answers = Object.fromEntries(
        names.map((name) => {
          const mismatch =
            (name === 'image_product' && d.imageId === 'headphones-cream') ||
            (name === 'no_overlay' &&
              d.imageId === 'plush-promo' &&
              !['integral_logo', 'ambiguous_mark'].includes(scenario)) ||
            name === 'bullet_locale' ||
            (name === 'bullet_facts' &&
              d.product === 'coffee' &&
              d.bullets.some((b) => b.includes('espresso')));
          const uncertain = name === 'no_overlay' && scenario === 'ambiguous_mark';
          return [
            name,
            {
              match: uncertain ? 0.15 : mismatch ? 0.005 : 0.99,
              mismatch: uncertain ? 0.13 : mismatch ? 0.99 : 0.005,
              insufficient_evidence: uncertain ? 0.72 : 0.005,
            },
          ];
        }),
      );
      return { model: 'controlled-observation', answers, usage: null, cost: null };
    },
    async prepare(c, allowed) {
      const recommendation: Action =
        scenario === 'flawed_missing_means_false'
          ? 'send_correction'
          : allowed.includes('send_correction')
            ? 'send_correction'
            : 'request_evidence';
      return {
        model: 'controlled-evaluation',
        usage: null,
        cost: null,
        result: {
          recommendation,
          suggestedText: 'Filter-basket drip brewing with an 8-cup glass carafe.',
          rationale: 'Fixture evidence comparison',
          uncertainties: [],
          citations:
            scenario === 'detached' ? ['pim/unrelated@1'] : c.finding.evidence.map((e) => e.ref),
        },
      };
    },
  };
}
function inputs(c: ReviewCase) {
  return {
    action: 'send_correction' as Action,
    expected_case_version: c.version,
    expected_listing_revision: c.revision,
    brief_id: c.brief!.id,
    idempotency_key: 'eval-approval',
  };
}
export async function evaluateScenario(
  s: Scenario,
  mode: 'controlled' | 'live' | 'flawed' = 'controlled',
) {
  const store = new Store(':memory:'),
    ai =
      mode === 'live' ? liveAI : controlledAI(mode === 'flawed' ? 'flawed_missing_means_false' : s),
    flow = new Workflow(store, ai);
  let observed = '',
    citations: string[] = [],
    permitted: Action[] = [],
    persisted = true,
    traceIds: string[] = [];
  try {
    if (['explicit', 'silent', 'stale', 'unauthorized', 'detached', 'closed'].includes(s)) {
      const id = s === 'silent' ? 'silent' : 'coffee',
        c = flow.report(id, shopperReport);
      while (await flow.prepareNext()) {}
      const reviewed = flow.read(c.id, 'maya');
      citations = reviewed.brief?.citations ?? [];
      permitted = reviewed.actions;
      observed = reviewed.brief?.recommendation ?? reviewed.prep;
      if (s === 'silent' && mode === 'flawed') {
        const row = store.db
          .prepare(
            "SELECT data FROM traces WHERE json_extract(data,'$.name')='preparation.rejected' LIMIT 1",
          )
          .get();
        observed = row ? JSON.parse(String(row.data)).route : observed;
      }
      if (s === 'unauthorized') {
        try {
          flow.read(c.id, 'agent' as Actor);
        } catch (e) {
          observed = String((e as Fault).status);
        }
      }
      if (s === 'stale' || s === 'closed') {
        const d = store.draft(id),
          edit = {
            title: d.title,
            bullets: [reviewed.brief!.suggestedText, ...d.bullets.slice(1)],
            imageId: d.imageId,
            placement: d.placement,
          };
        if (s === 'closed') {
          const request = inputs(reviewed);
          flow.act(c.id, 'maya', request);
          flow.act(c.id, 'maya', request);
          flow.save(id, 1, edit);
          await flow.check(id, 2);
          const end = store.case(c.id);
          observed = end.status;
          persisted =
            end.events.filter((e) => e.label === 'Correction requested').length === 1 &&
            store.record<{ revision: number }>('published/' + id).revision === 1;
        } else {
          flow.save(id, 1, edit);
          try {
            flow.act(c.id, 'maya', inputs(reviewed));
          } catch (e) {
            observed = String((e as Fault).status);
          }
          persisted = store.case(c.id).events.every((e) => e.label !== 'Correction requested');
        }
      }
      if (s === 'explicit' || s === 'silent')
        persisted =
          reviewed.finding.evidence.every((e) => citations.includes(e.ref)) &&
          reviewed.status === 'In review' &&
          (s === 'explicit'
            ? permitted.includes('send_correction')
            : !permitted.includes('send_correction'));
      if (s === 'detached') persisted = !reviewed.brief && !reviewed.actions.length;
    } else if (s === 'merchant') {
      const one = await flow.submitFeed('first', frenchBullets, 'agent');
      await flow.submitFeed('first', frenchBullets, 'agent');
      const two = await flow.submitFeed('second', frenchBullets, 'agent');
      await flow.submitFeed('second', frenchBullets, 'agent');
      observed =
        !one.caseId && two.caseId && store.cases().length === 1 ? 'one_case' : 'unexpected';
      const c = store.cases()[0];
      citations = c?.finding.evidence.map((e) => e.ref) ?? [];
      persisted = c?.attempts.length === 2 && c.attempts[1].locale === 'en-US';
    } else {
      const id = ['overlay', 'integral_logo', 'ambiguous_mark', 'secondary'].includes(s)
        ? 'plush'
        : s === 'refund'
          ? 'refund'
          : s === 'sibling'
            ? 'sibling'
            : 'headphones';
      let d = store.draft(id);
      if (s === 'wrong_color' || s === 'corrected')
        d = flow.save(id, d.revision, { ...d, imageId: 'headphones-cream' });
      if (s === 'corrected') {
        await flow.check(id, d.revision);
        d = flow.save(id, d.revision, { ...d, imageId: 'headphones-black' });
      }
      if (s === 'integral_logo' || s === 'ambiguous_mark') {
        // These policy fixtures are deliberately outside the seller's approved asset library.
        const imageId = s === 'integral_logo' ? 'plush-embroidered' : 'plush-unclear';
        d = { ...d, imageId, revision: d.revision + 1 };
        store.saveDraft(d);
      }
      if (s === 'secondary') d = flow.save(id, d.revision, { ...d, placement: 'secondary' });
      try {
        const run = await flow.check(id, d.revision);
        const target =
          s === 'refund'
            ? 'bullet_refund'
            : id === 'plush'
              ? 'no_overlay'
              : s === 'sibling'
                ? 'asset_approval'
                : 'image_product';
        const f = run.findings.find((f) => f.criterion.id === target);
        observed = f?.route ?? 'skipped';
        citations = f?.evidence.map((e) => e.ref) ?? [];
        persisted =
          Boolean(store.lastRun(id, d.revision)) &&
          store.cases().length === 0 &&
          (s === 'secondary' ? run.route !== 'green' : citations.length > 0);
        if (s === 'sibling') {
          const c = flow.help(id, d.revision, target, 'Can this family photo be used?');
          persisted =
            persisted &&
            c.assigned === 'Maya' &&
            run.route === 'yellow' &&
            c.finding.policy === run.policy;
        }
      } catch (e) {
        if (s !== 'outage') throw e;
        observed = 'unavailable';
        persisted = !store.lastRun(id, d.revision);
      }
    }
    traceIds = store.db
      .prepare('SELECT id FROM traces ORDER BY rowid')
      .all()
      .map((row) => String(row.id));
    return {
      scenario: s,
      mode,
      observed,
      expected: labels[s],
      citations,
      permitted,
      persisted,
      policy: policyVersion,
      traceIds,
    };
  } finally {
    await flushTraces();
    store.db.close();
  }
}
