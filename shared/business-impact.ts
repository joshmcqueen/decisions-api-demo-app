import type { Run } from './domain.ts';

export function projectImpact(runs: Run[], annualListings: number, checksPerListing: number) {
  if (!Number.isFinite(annualListings) || annualListings < 1 || annualListings > 1e12 ||
      !Number.isFinite(checksPerListing) || checksPerListing < 1 || checksPerListing > 100 ||
      !Number.isInteger(annualListings) || !Number.isInteger(checksPerListing)) return null;
  const decisions = runs.filter(r => r.engine === 'decisions');
  const responses = runs.filter(r => r.engine === 'responses');
  if (!decisions.length || decisions.length !== responses.length) return null;
  const first = decisions[0];
  const baseline = responses[0];
  // Only extrapolate one complete comparison with consistent evidence and pricing.
  if (runs.some(r => r.status === 'error' || r.cost?.usd == null || !Number.isFinite(r.cost.usd) || r.cost.usd < 0 ||
      r.fingerprint !== first.fingerprint || r.questionVersion !== first.questionVersion || r.cost.version !== first.cost?.version ||
      r.batchId !== first.batchId || r.mode !== first.mode) ||
      decisions.some(r => r.model !== first.model) ||
      responses.some(r => r.model !== baseline.model || r.settings.effort !== baseline.settings.effort)) return null;
  if (first.mode === 'repeat' && (new Set(decisions.map(r => r.repetition)).size !== decisions.length ||
      decisions.some(r => r.repetition == null || !responses.some(other => other.repetition === r.repetition)))) return null;
  const decisionsPerCheck = decisions.reduce((sum, r) => sum + r.cost!.usd!, 0) / decisions.length;
  const responsesPerCheck = responses.reduce((sum, r) => sum + r.cost!.usd!, 0) / responses.length;
  const annualChecks = annualListings * checksPerListing;
  const annualDecisions = annualChecks * decisionsPerCheck;
  const annualResponses = annualChecks * responsesPerCheck;
  const annualSavings = annualResponses - annualDecisions;
  return { pairs: decisions.length, baseline, decisionsPerCheck, responsesPerCheck, annualChecks,
    annualDecisions, annualResponses, annualSavings, monthlySavings: annualSavings / 12,
    quarterlySavings: annualSavings / 4, reduction: responsesPerCheck > 0 ? annualSavings / annualResponses : null };
}
