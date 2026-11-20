import { config } from 'dotenv';
import { Store, databasePath } from '../server/workflow-db.ts';
import { Workflow } from '../server/workflow.ts';
import { seedIntake } from '../server/onsite-runtime.ts';
import { flushTraces } from '../server/onsite-tracing.ts';
import { existsSync, renameSync } from 'node:fs';
config({ quiet: true });
const file = databasePath();
if (process.argv.includes('--reset')) {
  if (process.env.ONSITE_DB)
    throw Error('Reset only supports the default, dedicated rehearsal database.');
  // Archive all SQLite files together after stopping the server.
  for (const port of [process.env.PORT || 3001, process.env.MCP_PORT || 3002]) {
    const running = await fetch('http://127.0.0.1:' + port + '/', {
      signal: AbortSignal.timeout(1000),
    }).then(
      () => true,
      () => false,
    );
    if (running) throw Error('Stop the local API and reviewer MCP before archiving the database.');
  }
  const suffix = '.' + Date.now() + '.backup';
  for (const ext of ['', '-wal', '-shm'])
    if (existsSync(file + ext)) renameSync(file + ext, file + suffix + ext);
}
const store = new Store(file),
  flow = new Workflow(store);
await seedIntake(flow);
for (const c of store.cases()) if (c.prep === 'Preparation failed') flow.refresh(c.id, 'maya');
while (await flow.prepareNext()) {}
console.table(
  store.cases().map((c) => ({
    source: c.source,
    twin: c.twin,
    prepared: c.prep,
    model: c.brief?.model,
    action: c.brief?.recommendation,
  })),
);
if (store.cases().some((c) => c.prep !== 'Ready')) process.exitCode = 1;
await flushTraces();
store.db.close();
