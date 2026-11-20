import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { config } from 'dotenv';
import { databasePath } from '../server/workflow-db.ts';
config({ quiet: true });
if (process.env.ONSITE_DB)
  throw Error('Only the default dedicated rehearsal database supports this operation.');
const dbPath = databasePath(),
  copy = resolve(dirname(dbPath), 'prepared.sqlite');
if (process.argv.includes('--restore')) {
  if (!existsSync(copy)) throw Error('No prepared checkpoint. Use onsite:checkpoint first.');
  for (const port of [process.env.PORT || 3001, process.env.MCP_PORT || 3002]) {
    if (
      await fetch('http://127.0.0.1:' + port + '/', { signal: AbortSignal.timeout(1200) }).then(
        () => true,
        () => false,
      )
    )
      throw Error('Stop the local API and MCP listener before restoring.');
  }
  const archive = resolve(dirname(dbPath), 'run-' + Date.now());
  mkdirSync(archive);
  const staged = dbPath + '.restore-' + Date.now();
  copyFileSync(copy, staged);
  for (const ext of ['', '-wal', '-shm'])
    if (existsSync(dbPath + ext))
      renameSync(dbPath + ext, resolve(archive, 'rehearsal.sqlite' + ext));
  renameSync(staged, dbPath);
  console.log('Restored prepared cases and chat bindings. Completed run archived at ' + archive);
} else {
  if (!existsSync(dbPath)) throw Error('Prepare the rehearsal before taking a checkpoint.');
  const db = new DatabaseSync(dbPath),
    next = copy + '.' + Date.now();
  try {
    const cases = db
      .prepare(
        "SELECT json_extract(data,'$.prep') AS prep,json_extract(data,'$.status') AS status FROM cases",
      )
      .all();
    if (cases.length !== 3 || cases.some((c) => c.prep !== 'Ready' || c.status !== 'In review'))
      throw Error('The checkpoint requires the three prepared starting cases.');
    db.prepare('VACUUM INTO ?').run(next);
    // Do not copy live OAuth requests or temporary grants into a restored demo.
    const isolated = new DatabaseSync(next);
    isolated.exec('DELETE FROM oauth_pending');
    isolated.close();
    if (existsSync(copy)) renameSync(copy, copy + '.' + Date.now() + '.backup');
    renameSync(next, copy);
    console.log('Saved a consistent prepared checkpoint including ChatGPT bindings.');
  } finally {
    db.close();
  }
}
