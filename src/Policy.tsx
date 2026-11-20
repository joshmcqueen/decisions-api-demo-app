import { useEffect, useState } from 'react';
interface State {
  history: { id: string; version: string; at: string; passed: boolean; falseClears: number }[];
  active: string;
  base: string;
  candidate: string;
  rule: string;
  shadow: null | {
    id: string;
    passed: boolean;
    falseClears: number;
    rows: {
      file: string;
      name: string;
      placement: string;
      expected: string;
      baseline: string;
      candidate: string;
    }[];
  };
}
export function Policy() {
  const [s, set] = useState<State>(),
    [busy, lock] = useState(false),
    [error, fail] = useState('');
  async function request(op = '', body?: object) {
    lock(true);
    fail('');
    try {
      const r = await fetch('/api/policy' + op, {
        method: body ? 'POST' : 'GET',
        headers: { 'X-Onsite-View': 'policy', 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      set(data);
    } catch (e) {
      fail((e as Error).message);
    } finally {
      lock(false);
    }
  }
  useEffect(() => {
    void request();
  }, []);
  return (
    <>
      <div className="on-title">
        <div>
          <p className="on-kicker">CATALOG IMAGE POLICY OWNER</p>
          <h1>Main-image policy review</h1>
        </div>
      </div>
      <section className="on-panel">
        <small>US · main placement · named check no_overlay</small>
        <h2>Clarify how to assess embroidery</h2>
        <p>{s?.rule}</p>
        <p>
          Amazon owns the published requirement. The catalog policy owner can change the check used
          to interpret it.
        </p>
        <small>Active snapshot · {s?.active}</small>
        <button className="on-primary" disabled={busy} onClick={() => void request('/shadow', {})}>
          {busy ? 'Working…' : 'Run shadow comparison'}
        </button>
        {error && <p role="alert">{error}</p>}
        {s?.shadow && (
          <>
            <h3>Compared against labeled photographs</h3>
            {s.shadow.rows.map((row) => (
              <div className="on-shadow" key={row.name}>
                <img src={'/products/' + row.file} alt={row.name} />
                <div>
                  <b>
                    {row.name} · {row.placement}
                  </b>
                  <p>
                    Expected {row.expected} · Baseline {row.baseline} · Candidate {row.candidate}
                  </p>
                </div>
              </div>
            ))}
            <p>
              {s.shadow.falseClears} false clears ·{' '}
              {s.shadow.passed ? 'All four labels matched' : 'Candidate held for review'}
            </p>
            {s.active === s.base ? (
              <button
                className="on-primary"
                disabled={busy || !s.shadow.passed}
                onClick={() =>
                  void request('/activate', {
                    expected: s.active,
                    version: s.candidate,
                    review: s.shadow!.id,
                  })
                }
              >
                Promote reviewed candidate
              </button>
            ) : (
              <button
                disabled={busy}
                onClick={() =>
                  void request('/activate', {
                    expected: s.active,
                    version: s.base,
                    review: s.shadow!.id,
                  })
                }
              >
                Roll back to baseline
              </button>
            )}
          </>
        )}
        {s && s.history.length > 1 && (
          <details>
            <summary>Earlier shadow comparisons</summary>
            {s.history.slice(1).map((r) => (
              <p key={r.id}>
                <code>{r.version}</code> · {r.passed ? 'Passed' : 'Held'} · {r.falseClears} false
                clears
              </p>
            ))}
          </details>
        )}
      </section>
    </>
  );
}
