import type { Workflow } from './workflow.ts';
import { Fault, now, policyVersion, overlayVersion, overlayPolicy } from './workflow-db.ts';
import { loadPrompts } from './questions.ts';
import { trace } from './onsite-tracing.ts';
import { assets } from './catalog.ts';

const cases = [
  { image: 'plush-promo', name: 'Added badge', placement: 'main', expected: 'red' },
  { image: 'plush-embroidered', name: 'Integral embroidery', placement: 'main', expected: 'green' },
  { image: 'plush-unclear', name: 'Unclear surface mark', placement: 'main', expected: 'yellow' },
  {
    image: 'plush-promo',
    name: 'Secondary placement',
    placement: 'secondary',
    expected: 'skipped',
  },
] as const;

export async function shadowOverlay(flow: Workflow) {
  const d = flow.store.draft('plush'),
    baseline = loadPrompts(),
    candidate = flow.store.promptsFor(overlayVersion, baseline);
  const rows = [];
  for (const item of cases) {
    const observed: string[] = [];
    for (const [index, prompts] of [baseline, candidate].entries()) {
      if (item.placement === 'secondary') {
        observed.push('skipped');
        continue;
      }
      const start = Date.now(),
        result = await flow.decidePolicy({ ...d, imageId: item.image }, prompts);
      const p = result.answers.no_overlay;
      const outcome = p && p.match >= 0.9 ? 'green' : p && p.mismatch >= 0.9 ? 'red' : 'yellow';
      trace(flow.store, 'model.policy_shadow', start, {
        policy: index ? overlayVersion : policyVersion,
        prompt: prompts.version,
        model: result.model,
        usage: result.usage,
        estimated_usd: result.cost,
        route: outcome,
        evidence: ['asset/' + item.image + '@1'],
      });
      observed.push(outcome);
    }
    rows.push({
      ...item,
      file: assets.find((a) => a.id === item.image)!.file,
      baseline: observed[0],
      candidate: observed[1],
    });
  }
  const result = {
    id: crypto.randomUUID(),
    version: overlayVersion,
    baselineVersion: policyVersion,
    at: now(),
    rows,
    passed: rows.every((r) => r.candidate === r.expected),
    falseClears: rows.filter((r) => r.candidate === 'green' && r.expected !== 'green').length,
  };
  flow.store.put('shadow/' + result.id, result);
  return result;
}
export function policyState(flow: Workflow) {
  const last = flow.store.db
    .prepare("SELECT data FROM records WHERE ref LIKE 'shadow/%' ORDER BY rowid DESC LIMIT 1")
    .get();
  const history = flow.store.db
    .prepare("SELECT data FROM records WHERE ref LIKE 'shadow/%' ORDER BY rowid DESC LIMIT 6")
    .all()
    .map((r) => JSON.parse(String(r.data)));
  return {
    history,
    active: flow.store.policyId(),
    base: policyVersion,
    candidate: overlayVersion,
    rule: overlayPolicy.rule,
    shadow: last ? JSON.parse(String(last.data)) : null,
  };
}
export function activatePolicy(flow: Workflow, expected: string, version: string, review: string) {
  return flow.store.tx(() => {
    const state = policyState(flow);
    if (state.active !== expected)
      throw new Fault(409, 'Active policy changed. Refresh the comparison.');
    if (![state.base, state.candidate].includes(version)) throw new Fault(400, 'Unknown policy');
    if (
      version === state.candidate &&
      (!state.shadow?.passed || state.shadow.id !== review || state.shadow.version !== version)
    )
      throw new Fault(409, 'The current shadow run must pass before promotion.');
    flow.store.db
      .prepare('INSERT INTO policy_events(version,at,actor,review) VALUES(?,?,?,?)')
      .run(version, now(), 'Catalog image policy owner', review);
    return policyState(flow);
  });
}
