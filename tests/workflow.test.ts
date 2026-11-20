import { describe, it, expect } from 'vitest';
import { labels, evaluateScenario, type Scenario } from '../eval/scenarios.ts';
import { readAnswers } from '../server/workflow-ai.ts';
describe('workflow release contracts', () => {
  it.each(Object.keys(labels) as Scenario[])('%s', async (s) => {
    const r = await evaluateScenario(s);
    expect(r.observed).toBe(r.expected);
    expect(r.persisted).toBe(true);
  });
  it('rejects incomplete or corrupt probability distributions', () => {
    const raw = (v: unknown) => ({
      answers: [{ name: 'check', type: 'choice', choice: 'match', probabilities: v }],
    });
    expect(() => readAnswers(raw([]), ['check'])).toThrow();
    expect(() =>
      readAnswers(
        raw([
          { value: 'match', probability: 1 },
          { value: 'match', probability: 1 },
          { value: 'insufficient_evidence', probability: 0 },
        ]),
        ['check'],
      ),
    ).toThrow();
    expect(
      readAnswers(
        raw([
          { value: 'insufficient_evidence', probability: 0.12 },
          { value: 'mismatch', probability: 0.13 },
          { value: 'match', probability: 0.75 },
        ]),
        ['check'],
      ).check?.match,
    ).toBe(0.75);
  });
});

import { Store, policyVersion, overlayVersion } from '../server/workflow-db.ts';
import { Workflow } from '../server/workflow.ts';
import { controlledAI } from '../eval/scenarios.ts';
import { activatePolicy, shadowOverlay } from '../server/overlay-policy.ts';
it('invalidates an open brief on source changes and keeps the published evidence intact', async () => {
  const s = new Store(':memory:');
  try {
    const flow = new Workflow(s, controlledAI('source')),
      c = flow.report('coffee', 'Does it brew espresso?');
    await flow.prepareNext();
    const before = s.case(c.id);
    flow.verifySource('coffee', {
      kind: 'fact',
      expectedRevision: 1,
      field: 'Espresso function',
      value: '',
      basis: 'Revised synthetic manufacturer sheet',
    });
    expect(s.case(c.id).prep).toBe('Stale brief');
    expect(s.draft('coffee', 1).facts['Espresso function']).toMatch(/Not supported/);
    expect(s.draft('silent').revision).toBe(1);
    expect(() =>
      flow.act(c.id, 'maya', {
        action: 'send_correction',
        brief_id: before.brief!.id,
        expected_case_version: before.version,
        expected_listing_revision: 1,
        idempotency_key: 'old',
      }),
    ).toThrow(/stale/);
    const run = await flow.check('coffee', 2);
    expect(run.findings.find((f) => f.criterion.id === 'bullet_facts')?.route).toBe('yellow');
    flow.refresh(c.id, 'maya');
    await flow.prepareNext();
    expect(s.case(c.id).actions).not.toContain('send_correction');
  } finally {
    s.db.close();
  }
});
it('requires a passing four-case shadow and preserves snapshots through promotion and rollback', async () => {
  const s = new Store(':memory:');
  try {
    const ai = controlledAI('policy'),
      controlled = ai.decide;
    ai.decide = async (d, names, prompts, signal) => {
      if (d.imageId === 'plush-unclear')
        return controlledAI('ambiguous_mark').decide(d, names, prompts, signal);
      return controlled(d, names, prompts, signal);
    };
    const flow = new Workflow(s, ai);
    expect(() => activatePolicy(flow, policyVersion, overlayVersion, 'missing')).toThrow();
    const comparison = await shadowOverlay(flow);
    expect(comparison.passed).toBe(true);
    const c = flow.report('coffee', 'Can this make espresso?');
    await flow.prepareNext();
    const before = s.case(c.id);
    flow.act(c.id, 'maya', {
      action: 'send_correction',
      expected_case_version: before.version,
      expected_listing_revision: c.revision,
      brief_id: before.brief!.id,
      idempotency_key: 'original',
    });
    activatePolicy(flow, policyVersion, overlayVersion, comparison.id);
    const run = await flow.check('plush', 1);
    expect(run.policy).toBe(overlayVersion);
    expect(run.findings.find((f) => f.criterion.id === 'no_overlay')?.question).toContain(
      'monogram',
    );
    expect(s.case(c.id).events.at(-1)?.policy).toBe(policyVersion);
    expect(activatePolicy(flow, overlayVersion, policyVersion, comparison.id).active).toBe(
      policyVersion,
    );
  } finally {
    s.db.close();
  }
});

it('rechecks tenant and assignment before disclosing a case or recording a decision', async () => {
  const store = new Store(':memory:');
  try {
    const flow = new Workflow(store, controlledAI('authorization')),
      c = flow.report('coffee', 'Does this brew espresso?');
    await flow.prepareNext();
    const original = flow.read(c.id, 'maya');
    flow.assign(c.id, original.version, 'Unassigned');
    expect(() => flow.read(c.id, 'maya')).toThrow('Case unavailable');
    expect(() =>
      flow.act(c.id, 'maya', {
        action: 'send_correction',
        expected_case_version: original.version,
        expected_listing_revision: 1,
        brief_id: original.brief!.id,
        idempotency_key: 'denied',
      }),
    ).toThrow('Case unavailable');
    const different = {
      ...store.case(c.id),
      assigned: 'Maya',
      merchant: 'Independent synthetic tenant',
    };
    store.saveCase(different, '');
    expect(() => flow.read(c.id, 'maya')).toThrow('Case unavailable');
    expect(store.case(c.id).events.filter((e) => e.label === 'Correction requested')).toHaveLength(
      0,
    );
  } finally {
    store.db.close();
  }
});
