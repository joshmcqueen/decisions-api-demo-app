import { mkdir, writeFile } from 'node:fs/promises';
import { fixtures } from '../server/catalog.ts';
import { DEFAULT_SETTINGS, type Engine, type Run } from '../shared/domain.ts';
import { csv } from '../shared/statistics.ts';

// Explicit live evaluation: twelve API requests; no simulated answers or retries.
const runs: Run[] = [];
for (const [i,fixture] of fixtures.entries()) {
  for (const engine of (i%2 ? ['responses','decisions'] : ['decisions','responses']) as Engine[]) {
    const start = performance.now();
    const response = await fetch('http://127.0.0.1:3001/api/preflight', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ engine, listing:fixture.listing, settings:DEFAULT_SETTINGS }) });
    const result = await response.json();
    if (!response.ok) throw new Error(`${fixture.id}: ${result.error}`);
    const run: Run = { ...result, roundTripMs:performance.now()-start, mode:'repeat', batchId:'initial-fixture-evaluation' };
    runs.push(run);
    console.log(JSON.stringify({ fixture:fixture.id, engine, status:run.status, sdkMs:Math.round(run.sdkMs??0), agreement:run.agreement, estimatedUsd:run.cost?.usd, error:run.error, checks:run.checks }));
  }
}
await mkdir('output/evaluation',{recursive:true});
await writeFile('output/evaluation/initial-results.json',JSON.stringify({ evaluatedAt:new Date().toISOString(), notes:'Six synthetic fixtures, one run per endpoint per fixture. Exploratory, not production accuracy. Identical image bytes and question definitions; Luna/none baseline.',runs },null,2));
await writeFile('output/evaluation/initial-results.csv',csv(runs));
console.log('Saved output/evaluation/initial-results.json and .csv');
if (runs.some(r => r.status === 'error')) process.exitCode=1;
