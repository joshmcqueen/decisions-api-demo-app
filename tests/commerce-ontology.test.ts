import { afterEach, expect, it, vi } from 'vitest';
import { Decisions } from 'openai/resources/decisions';
import { Responses } from 'openai/resources/responses/responses';
import model from '../data/commerce-ontology.json' with { type: 'json' };
import * as commerce from '../server/commerce-ontology.ts';
import { Store, evidence } from '../server/workflow-db.ts';
import { Workflow } from '../server/workflow.ts';
import { liveAI, briefPrompt, preparationVersion } from '../server/workflow-ai.ts';
import { loadPrompts } from '../server/questions.ts';
import { controlledAI } from '../eval/scenarios.ts';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('validates the packaged domain and selects only applicable evidence', () => {
  expect(commerce.parseOntology(model).version).toBe(model.version);
  expect(() => commerce.parseOntology({ ...model, concepts: {} })).toThrow();
  const s = new Store(':memory:');
  try {
    for (const id of ['plush', 'refund']) {
      const d = s.draft(id);
      expect(commerce.resolveKnowledgeTrace(d, evidence(s, d))).toBeUndefined();
    }
    const secondary = { ...s.draft('sibling'), placement: 'secondary' as const };
    expect(commerce.resolveKnowledgeTrace(secondary, evidence(s, secondary))).toBeUndefined();
    for (const bullet of ['Does not brew espresso', 'Brews filter coffee', 'Brews espresso-style coffee',
      'Does it brew espresso?', 'Includes espresso beans', 'Unlike machines that brew espresso',
      'Brews espresso flavored coffee']) {
      expect(commerce.espressoBullet([bullet])).toBeUndefined();
    }
  } finally { s.db.close(); }
});

it('binds fresh evidence references when reusing a result, and rechecks only changed semantics', async () => {
  const s = new Store(':memory:');
  try {
    const ai = controlledAI('cache'), decide = vi.spyOn(ai, 'decide'), flow = new Workflow(s, ai);
    const first = await flow.check('coffee', 1);
    const d = s.draft('coffee');
    flow.save('coffee', 1, { ...d, imageId: 'coffee-lifestyle' });
    const second = await flow.check('coffee', 2);
    const finding = second.findings.find(f => f.criterion.id === 'bullet_facts')!;
    expect(decide.mock.calls[1][1]).not.toContain('bullet_facts');
    expect(finding.knowledgeTrace?.listingRef).toBe('listing/coffee@2');
    expect(first.findings.find(f => f.criterion.id === 'bullet_facts')?.knowledgeTrace?.listingRef).toBe('listing/coffee@1');

    const changed = structuredClone(model);
    changed.concepts.EspressoBrewing.requirement = 'Consult the exact-SKU beverage specification.';
    const resolve = commerce.resolveKnowledgeTrace, updated = commerce.parseOntology(changed);
    vi.spyOn(commerce, 'resolveKnowledgeTrace').mockImplementation((d, refs) => resolve(d, refs, updated));
    await flow.check('coffee', 2);
    expect(decide.mock.calls[2][1]).toEqual(['bullet_facts']);
    expect(decide.mock.calls[2][5]?.domain.requirement).toBe(changed.concepts.EspressoBrewing.requirement);
  } finally { s.db.close(); }
});

it('sends selected domain context through the SDK and preserves the original brief identity for legacy cases', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'unused-test-key');
  const decisions = vi.spyOn(Decisions.prototype, 'create').mockRejectedValue(new Error('Captured'));
  const responses = vi.spyOn(Responses.prototype, 'create').mockRejectedValue(new Error('Captured'));
  const s = new Store(':memory:');
  try {
    const d = s.draft('silent'), flow = new Workflow(s, controlledAI('silent'));
    const c = flow.report(d.id, 'Does it make espresso?');
    const trace = c.finding.knowledgeTrace!;
    expect(trace).toMatchObject({ listingRef: 'listing/silent@1', sourceRef: d.pimRef,
      observation: 'Undocumented in this manufacturer record.' });
    expect(trace.sourceRef).not.toBe(s.draft('coffee').pimRef);
    for (const names of [['bullet_facts'], ['no_overlay']]) {
      await expect(liveAI.decide(d, names, loadPrompts(), undefined, undefined, trace)).rejects.toThrow('Captured');
    }
    const input = decisions.mock.calls.map(([params]) => JSON.parse(JSON.stringify(params.input))[0].content[1].data);
    expect(input[0]).toMatchObject({ ontology_context: trace.domain, referenced_field: { source: d.pimRef } });
    expect(JSON.stringify(input[0])).not.toContain('VariantMainImage');
    expect(input[1]).not.toHaveProperty('ontology_context');
    await expect(liveAI.prepare(c, ['request_evidence'])).rejects.toThrow('Captured');
    expect(JSON.parse(String(responses.mock.calls[0][0].input))).toMatchObject({
      knowledge_trace: trace, policy_version: c.finding.policy, allowed: ['request_evidence'],
    });
    expect(preparationVersion(c)).not.toBe(briefPrompt);
    delete c.finding.knowledgeTrace;
    expect(preparationVersion(c)).toBe(briefPrompt);
  } finally { s.db.close(); }
});

it('uses the actual asset approval on graphite escalation and preserves its case snapshot after verification', async () => {
  const s = new Store(':memory:');
  try {
    const flow = new Workflow(s, controlledAI('sibling'));
    await flow.check('sibling', 1);
    const c = flow.help('sibling', 1, 'asset_approval', 'Can I use this family photo?');
    const trace = c.finding.knowledgeTrace!;
    expect(trace).toMatchObject({ domain: { concept: 'VariantMainImage', criterionId: 'asset_approval' },
      subject: 'Main photo for FORM-H01-GPH', observation: 'Approved for FORM-H01-BLK / main' });
    expect(c.evidence.map(e => e.ref)).toContain(trace.sourceRef);
    await flow.prepareNext();
    const brief = s.case(c.id).brief!;
    expect(s.record('brief/' + brief.id)).toMatchObject({ knowledgeTrace: trace });
    flow.verifySource('sibling', { kind: 'approval', expectedRevision: 1, basis: 'New synthetic approval' });
    const run = await flow.check('sibling', 2);
    const finding = run.findings.find(f => f.criterion.id === 'asset_approval')!;
    expect(finding.route).toBe('green');
    expect(finding.knowledgeTrace?.observation).toBe('Approved for FORM-H01-GPH / main');
    expect(finding.knowledgeTrace?.sourceRef).not.toBe(trace.sourceRef);
    expect(s.case(c.id).finding.knowledgeTrace).toEqual(trace);
  } finally { s.db.close(); }
});
