import type { Run } from './domain.ts';
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const a = [...values].sort((x,y) => x-y);
  const i = (a.length - 1) * p;
  return a[Math.floor(i)] + (a[Math.ceil(i)] - a[Math.floor(i)]) * (i % 1);
}
export function summarize(runs: Run[]) {
  const successful = runs.filter(r => r.status !== 'error' && r.sdkMs != null);
  const times = successful.map(r => r.sdkMs!);
  const labeled = successful.filter(r => r.agreement);
  const costed = runs.filter(r => r.cost?.usd != null);
  return { count: runs.length, successes: successful.length, errors: runs.length - successful.length,
    median: percentile(times, .5), p95: times.length >= 20 ? percentile(times, .95) : null,
    min: times.length ? Math.min(...times) : null, max: times.length ? Math.max(...times) : null,
    cost: costed.reduce((s,r) => s + r.cost!.usd!, 0), costCount: costed.length,
    agreement: labeled.length ? labeled.reduce((s,r) => s+r.agreement!.correct, 0) / labeled.reduce((s,r) => s+r.agreement!.total,0) : null,
  };
}
export function csv(runs: Run[]) {
  const columns = ['id','timestamp','engine','model','reasoning','mode','batch_id','repetition','fingerprint','fixture_id','question_version','status','sdk_ms','round_trip_ms','input_tokens','cached_tokens','cache_write_tokens','output_tokens','reasoning_tokens','estimated_usd','pricing_version','expected_correct','expected_total','error', 'checks'];
  const escape = (v: unknown) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"','""')}"`; };
  return [columns, ...runs.map(r => [r.id,r.timestamp,r.engine,r.model,r.settings.effort,r.mode,r.batchId,r.repetition,r.fingerprint,r.fixtureId,r.questionVersion,r.status,r.sdkMs,r.roundTripMs,r.usage?.input,r.usage?.cached,r.usage?.cacheWrite,r.usage?.output,r.usage?.reasoning,r.cost?.usd,r.cost?.version,r.agreement?.correct,r.agreement?.total,r.error,JSON.stringify(r.checks)])].map(row => row.map(escape).join(',')).join('\r\n');
}
