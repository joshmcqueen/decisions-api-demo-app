import { Client } from 'langsmith';
import { randomUUID } from 'node:crypto';
import type { Usage } from '../shared/domain.ts';
import type { Store } from './workflow-db.ts';
export type TraceFields = {
  case_id?: string;
  revision?: number;
  model?: string;
  prompt?: string;
  policy?: string;
  evidence?: string[];
  route?: string;
  error_class?: string;
  usage?: Usage | null;
  estimated_usd?: number | null;
  candidate?: string;
};
const pending = new Set<Promise<void>>();
let client: Client | undefined;
export function trace(store: Store, name: string, start: number, fields: TraceFields) {
  const id = randomUUID(),
    end = Date.now();
  // Construct an explicit export payload at the boundary. No raw requests or responses.
  const metadata = Object.fromEntries(
    Object.entries(fields).filter(([k]) =>
      [
        'case_id',
        'revision',
        'model',
        'prompt',
        'policy',
        'evidence',
        'route',
        'error_class',
        'usage',
        'estimated_usd',
        'candidate',
      ].includes(k),
    ),
  );
  if (fields.estimated_usd != null)
    metadata.pricing_version = fields.model?.startsWith('gpt-6.2-sol')
      ? '2026-11-18-standard-short-context'
      : '2026-11-05-standard-short-context';
  const data = { id, name, latency_ms: end - start, ...metadata };
  try {
    store.db.prepare('INSERT INTO traces VALUES(?,?)').run(id, JSON.stringify(data));
  } catch {
    console.warn('Local diagnostic span unavailable for ' + id);
  }
  if (process.env.LANGSMITH_API_KEY && process.env.ONSITE_TRACE !== 'off') {
    const sending = Promise.resolve()
      .then(() => {
        client ??= new Client({ autoBatchTracing: false });
        return client.createRun({
          id,
          project_name: process.env.LANGSMITH_PROJECT || 'seller-validator-onsite',
          name,
          run_type: name.includes('model') ? 'llm' : 'tool',
          inputs: { revision: fields.revision },
          outputs: { route: fields.route },
          extra: { metadata: { ...metadata, latency_ms: end - start } },
          start_time: start,
          end_time: end,
          error: fields.error_class,
        });
      })
      .catch(() => {
        console.warn('LangSmith export unavailable for run ' + id);
      });
    pending.add(sending);
    void sending.finally(() => pending.delete(sending));
  }
  return id;
}
export async function flushTraces() {
  await Promise.allSettled([...pending]);
}
