import { createHash } from 'node:crypto';
import { CHECK_IDS, route, type Check, type Engine, type Model, type Outcome, type Usage, type Cost } from '../shared/domain.ts';
import { isOutcome } from './questions.ts';

export const PRICING_VERSION = '2026-11-05-standard-short-context';
const source = 'https://developers.openai.com/api/docs/pricing';
const standard = {
  'gpt-6-luna': { input: 0.10, cached: 0.01, cacheWrite: 0.125, output: 0.50 },
  'gpt-6.1-sol': { input: 2.00, cached: 0.10, cacheWrite: 2.50, output: 10.00 },
};
export function estimateCost(engine: Engine, model: Model, usage: Usage | null): Cost {
  const rates = { ...standard[model], output: engine === 'decisions' ? 0 : standard[model].output };
  const valid = usage && Object.values(usage).every(v => Number.isFinite(v) && v >= 0) && usage.cached + usage.cacheWrite <= usage.input;
  const usd = valid ? ((usage.input - usage.cached - usage.cacheWrite) * rates.input + usage.cached * rates.cached + usage.cacheWrite * rates.cacheWrite + usage.output * rates.output) / 1e6 : null;
  return { usd, rates, version: PRICING_VERSION, source: engine === 'decisions' ? 'https://developers.openai.com/api/docs/guides/decisions' : source, note: 'Estimate in USD from reported usage. Standard processing, short context, default cache duration; excludes regional premiums, tax, hosting, and image preparation.' };
}
export function normalizeUsage(raw: unknown): Usage | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, any>;
  if (typeof u.input_tokens !== 'number' || typeof u.output_tokens !== 'number') return null;
  return { input: u.input_tokens, output: u.output_tokens, cached: u.input_tokens_details?.cached_tokens ?? 0, cacheWrite: u.input_tokens_details?.cache_write_tokens ?? 0, reasoning: u.output_tokens_details?.reasoning_tokens ?? 0 };
}
export function normalizeDecisions(raw: unknown): Check[] {
  const answers = (raw as { answers?: any[] })?.answers;
  if (!Array.isArray(answers)) throw new Error('INVALID_OUTPUT');
  if (answers.length !== CHECK_IDS.length || new Set(answers.map(a => a.name)).size !== CHECK_IDS.length || answers.some(a => !CHECK_IDS.includes(a.name))) throw new Error('INVALID_OUTPUT');
  return CHECK_IDS.map(id => {
    const a = answers.find(a => a.name === id);
    if (a?.type === 'refusal') return { id, outcome: 'insufficient_evidence' };
    if (a?.type !== 'choice' || !isOutcome(a.choice)) throw new Error('INVALID_OUTPUT');
    return { id, outcome: a.choice };
  });
}
export function normalizeResponses(text: string): Check[] {
  const result = JSON.parse(text);
  if (!result || typeof result !== 'object' || Object.keys(result).length !== CHECK_IDS.length || CHECK_IDS.some(id => !isOutcome(result[id]))) throw new Error('INVALID_OUTPUT');
  return CHECK_IDS.map(id => ({ id, outcome: result[id] as Outcome }));
}
export function fingerprint(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20); }
export function agreement(checks: Check[], expected: Record<string, Outcome>) { return { correct: checks.filter(c => c.outcome === expected[c.id]).length, total: CHECK_IDS.length }; }
export { route };
