import { useEffect, useState } from 'react';
interface Result {
  mode: string;
  scenario: string;
  reason: string;
  policy: string;
  traceUrl?: string;
  experimentUrl?: string;
  experimentScore?: number;
  timestamp: string;
  passed: number;
  failed: number;
  citations: string[];
  permitted: string[];
  evalId: string;
}
const names: Record<string, string> = {
  flawed: 'Candidate with the missing-evidence error',
  live: 'Corrected live-model run',
  controlled: 'Controlled release checks',
};
export function Release() {
  const [results, setResults] = useState<Result[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/release', { signal: controller.signal, headers: { 'X-Onsite-View': 'engineer' } })
      .then(async (r) => {
        if (!r.ok) throw Error('Release evidence unavailable');
        setResults(await r.json());
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  return (
    <>
      <div className="on-title">
        <div>
          <p className="on-kicker">PLATFORM ENGINEERING</p>
          <h1>Release evidence</h1>
          <p>Can a missing espresso specification trigger a correction request?</p>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="on-content">
        {results.map((r) => (
          <section key={r.mode} className="on-panel">
            <small>Promptfoo · {r.evalId}</small>
            <h2>{names[r.mode]}</h2>
            <strong>
              {r.passed} passed · {r.failed} failed
            </strong>
            <p>
              {r.mode === 'flawed'
                ? 'This controlled candidate proposed a correction when the manufacturer record was silent. The case service rejected its recommendation.'
                : r.reason}
            </p>
            {r.mode === 'flawed' && <pre>{r.reason}</pre>}
            {r.permitted.length > 0 && <p>Permitted actions · {r.permitted.join(', ')}</p>}
            <small>
              {r.policy} · {r.citations.join(' · ')}
            </small>
            {r.experimentUrl && (
              <p>
                <a href={r.experimentUrl} target="_blank" rel="noreferrer">
                  Open labeled experiment · score {r.experimentScore} / 1 ↗
                </a>
              </p>
            )}
            {r.traceUrl && (
              <p>
                <a href={r.traceUrl} target="_blank" rel="noreferrer">
                  Open private LangSmith trace ↗
                </a>
              </p>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
