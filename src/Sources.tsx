import { useEffect, useState } from 'react';
import type { Draft } from '../shared/workflow.ts';
export function Sources() {
  const [drafts, set] = useState<Draft[]>([]),
    [id, select] = useState('coffee'),
    [field, setField] = useState('Espresso function'),
    [value, edit] = useState(''),
    [basis, explain] = useState(''),
    [result, report] = useState(''),
    [busy, lock] = useState(false);
  const d = drafts.find((d) => d.id === id);
  async function load() {
    const r = await fetch('/api/sources', { headers: { 'X-Onsite-View': 'steward' } });
    if (!r.ok) throw Error('Sources unavailable');
    set(await r.json());
  }
  useEffect(() => {
    void load().catch((e) => report(e.message));
  }, []);
  useEffect(() => {
    if (d) edit(d.facts[field] ?? '');
  }, [d, field]);
  async function save(kind: 'fact' | 'approval') {
    if (!d) return;
    lock(true);
    try {
      const response = await fetch('/api/sources/' + id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Onsite-View': 'steward' },
        body: JSON.stringify({
          kind,
          expectedRevision: d.revision,
          basis,
          ...(kind === 'fact' ? { field, value } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      await load();
      explain('');
      report(
        'Updated ' +
          data.updated +
          ' draft snapshots. Current checks completed for ' +
          data.validated +
          '.',
      );
    } catch (e) {
      report((e as Error).message);
    } finally {
      lock(false);
    }
  }
  return (
    <>
      <div className="on-title">
        <div>
          <p className="on-kicker">DATA STEWARD</p>
          <h1>Verified catalog sources</h1>
        </div>
      </div>
      <section className="on-panel">
        <label>
          Product record
          <select
            value={id}
            onChange={(e) => {
              select(e.target.value);
              setField(Object.keys(drafts.find((d) => d.id === e.target.value)!.facts)[0]);
            }}
          >
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.sku}
              </option>
            ))}
          </select>
        </label>
        {d && (
          <>
            <code>{d.pimRef}</code>
            <label>
              Manufacturer field
              <select value={field} onChange={(e) => setField(e.target.value)}>
                {Array.from(
                  new Set([
                    ...Object.keys(d.facts),
                    ...(d.product === 'coffee' ? ['Espresso function'] : []),
                  ]),
                ).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              Verified value
              <input value={value} onChange={(e) => edit(e.target.value)} />
            </label>
            <label>
              Verification source or rationale
              <textarea value={basis} onChange={(e) => explain(e.target.value)} required />
            </label>
            <button
              className="on-primary"
              disabled={busy || !basis.trim() || value === (d.facts[field] ?? '')}
              onClick={() => void save('fact')}
            >
              Save verified fact
            </button>
            <h3>Current photo approval</h3>
            <p>
              {d.sku} · {d.imageId} · {d.placement}
            </p>
            <button disabled={busy || !basis.trim()} onClick={() => void save('approval')}>
              Verify this variant and placement
            </button>
          </>
        )}
        <p role="status">{result}</p>
      </section>
    </>
  );
}
