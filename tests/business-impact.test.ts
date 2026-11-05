import { describe, expect, it } from 'vitest';
import { projectImpact } from '../shared/business-impact.ts';
import { DEFAULT_SETTINGS, type Run } from '../shared/domain.ts';

function run(engine: Run['engine'], cost: number, extra: Partial<Run> = {}): Run {
  return { engine, status: 'passed', model: engine === 'decisions' ? 'gpt-6-luna' : 'gpt-6.1-sol',
    settings: engine === 'decisions' ? DEFAULT_SETTINGS : { model: 'gpt-6.1-sol', effort: 'medium' },
    fingerprint: 'same-evidence', questionVersion: 'v1', mode: 'repeat', batchId: 'batch-1', repetition: 1,
    cost: { usd: cost, version: 'v1' }, ...extra } as Run;
}

describe('business impact from measured costs', () => {
  it('uses the mean of the entire batch, then scales by checks rather than criteria or requests in the experiment', () => {
    const result = projectImpact([run('decisions', .0001), run('responses', .001),
      run('decisions', .0003, { repetition: 2 }), run('responses', .003, { repetition: 2 })], 100_000_000, 3)!;
    expect(result.pairs).toBe(2);
    expect(result.annualChecks).toBe(300_000_000);
    expect(result.annualDecisions).toBeCloseTo(60_000);
    expect(result.annualResponses).toBeCloseTo(600_000);
    expect(result.annualSavings).toBeCloseTo(540_000);
    expect(result.monthlySavings).toBeCloseTo(45_000);
    expect(result.quarterlySavings).toBeCloseTo(135_000);
    expect(result.reduction).toBeCloseTo(.9);
  });
  it('preserves tiny per-check differences and negative savings', () => {
    const result = projectImpact([run('decisions', .0000001), run('responses', 0)], 1_000_000_000, 1)!;
    expect(result.annualSavings).toBe(-100);
    expect(result.reduction).toBeNull();
  });
  it('supports equal and free estimates without dividing by zero', () => {
    expect(projectImpact([run('decisions', 0), run('responses', 0)], 1, 1)).toMatchObject({ annualSavings: 0, reduction: null });
  });
  it('withholds projections for incomplete, failed, or unknown-cost samples', () => {
    expect(projectImpact([run('decisions', .001)], 1, 1)).toBeNull();
    for (const extra of [{ status: 'error' }, { cost: null }, { cost: { usd: null } }, { cost: { usd: NaN } }, { cost: { usd: -1 } }]) {
      expect(projectImpact([run('decisions', .001), run('responses', .002, extra as Partial<Run>)], 1, 1)).toBeNull();
    }
  });
  it('rejects mixed evidence, configurations, pricing, batches, and mismatched repetitions', () => {
    for (const extra of [{ fingerprint: 'other' }, { questionVersion: 'other' }, { batchId: 'other' },
      { cost: { usd: .002, version: 'other' } }, { repetition: 2 }, { mode: 'live' }]) {
      expect(projectImpact([run('decisions', .001), run('responses', .002, extra as Partial<Run>)], 1, 1)).toBeNull();
    }
    expect(projectImpact([run('decisions', .001), run('responses', .002), run('decisions', .001, { repetition: 2 }),
      run('responses', .002, { repetition: 2, settings: { model: 'gpt-6.1-sol', effort: 'high' } })], 1, 1)).toBeNull();
  });
  it('rejects invalid scale assumptions', () => {
    const runs = [run('decisions', .001), run('responses', .002)];
    for (const [listings, checks] of [[0, 3], [-1, 3], [1.5, 3], [NaN, 3], [Infinity, 3], [1e13, 3], [100, 0], [100, 101], [100, 1.5]]) {
      expect(projectImpact(runs, listings, checks)).toBeNull();
    }
  });
});
