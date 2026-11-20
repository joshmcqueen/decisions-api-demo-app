import { useEffect, useState } from 'react';
export function Connect() {
  const [grant, set] = useState<{ scopes: string[]; resource: string; redirect: string }>(),
    [write, allow] = useState(false),
    [error, fail] = useState('');
  const path =
    '/api/reviewer-grant/' +
    encodeURIComponent(new URLSearchParams(location.search).get('request') || '');
  const headers = { 'X-Onsite-View': 'maya', 'Content-Type': 'application/json' };
  useEffect(() => {
    fetch(path, { headers })
      .then(async (r) => {
        const v = await r.json();
        if (!r.ok)
          throw Error(
            r.status === 401
              ? 'Open Reviewer queue in a separate local tab, then reload this page.'
              : v.error,
          );
        set(v);
      })
      .catch((e) => fail(e.message));
  }, [path]);
  async function consent() {
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify({ allowWrite: write }),
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error);
      location.assign(v.redirect);
    } catch (e) {
      fail((e as Error).message);
    }
  }
  return (
    <main className="onsite">
      <section className="on-panel">
        <small>Local presenter account · Maya</small>
        <h1>Connect ChatGPT to the reviewer queue</h1>
        {grant && (
          <>
            <p>
              Allow {grant.redirect} to read Maya’s assigned synthetic cases and their evidence for
              one hour.
            </p>
            <code>{grant.resource}</code>
            {grant.scopes.includes('case:write') && (
              <label>
                <input type="checkbox" checked={write} onChange={(e) => allow(e.target.checked)} />
                Allow confirmed case dispositions
              </label>
            )}
            <button className="on-primary" onClick={() => void consent()}>
              Authorize as Maya
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    </main>
  );
}
