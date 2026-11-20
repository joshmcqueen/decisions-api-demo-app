import { useState, useEffect } from 'react';
import { Activity, Clock3, Users } from 'lucide-react';
const number = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 });
export function Pilot() {
  const [a, set] = useState({
    volume: 12000000,
    baseline: 10,
    pilot: 9,
    before: 20,
    after: 15,
    rate: 60,
    cost: 0,
  });
  const [message, report] = useState('');
  const [observed, show] = useState<{
    assignments: { id: string; sku: string; category: string; assigned: string; version: number }[];
    cases: number;
    submittedCases: number;
    shopperReports: number;
    activeMinutes: number;
    queueMinutes: number | null;
    sellerWaitMinutes: number | null;
  }>();
  function refresh() {
    return fetch('/api/operations', { headers: { 'X-Onsite-View': 'operations' } })
      .then((r) => (r.ok ? r.json() : undefined))
      .then(show)
      .catch(() => report('Operations data unavailable.'));
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function assign(id: string, expectedVersion: number, reviewer: string) {
    const response = await fetch('/api/operations/' + id + '/assignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Onsite-View': 'operations' },
      body: JSON.stringify({ expectedVersion, reviewer }),
    });
    const result = await response.json();
    report(response.ok ? 'Assignment recorded.' : result.error);
    await refresh();
  }
  const avoided = (a.baseline - a.pilot) * 10,
    routing = avoided * a.before,
    prepared = a.pilot * 10 * (a.before - a.after),
    factor = a.volume / 1000 / 60;
  const labels = {
    volume: 'Eligible submissions per year',
    baseline: 'Baseline review rate (%)',
    pilot: 'Pilot review rate (%)',
    before: 'Baseline minutes per case',
    after: 'Prepared minutes per case',
    rate: 'Loaded hourly cost ($)',
    cost: 'Annual AI and operating costs ($)',
  };
  return (
    <>
      <div className="on-title">
        <div>
          <p className="on-kicker">SELLING PARTNER EXPERIENCE</p>
          <h1>Pilot impact</h1>
          <p>US small appliances · Editable operating assumptions</p>
        </div>
      </div>
      <section className="on-metrics">
        {[
          [
            Users,
            'Specialist cases per 1,000',
            number(10 * a.pilot),
            'Baseline ' + number(10 * a.baseline),
          ],
          [
            Clock3,
            'Active minutes per remaining case',
            number(a.after),
            'Baseline ' + number(a.before),
          ],
          [
            Activity,
            'Capacity minutes per 1,000',
            number(routing + prepared),
            number(routing) + ' from routing + ' + number(prepared) + ' from preparation',
          ],
        ].map(([Icon, label, value, caption]) => {
          const I = Icon as typeof Users;
          return (
            <article className="on-panel" key={String(label)}>
              <I />
              <h3>{String(label)}</h3>
              <strong>{String(value)}</strong>
              <small>{String(caption)}</small>
            </article>
          );
        })}
      </section>
      <div className="on-columns">
        <section className="on-panel">
          <h2>Scenario assumptions</h2>
          {(Object.keys(a) as (keyof typeof a)[]).map((k) => (
            <label key={k}>
              {labels[k]}
              <input
                type="number"
                min="0"
                max={['pilot', 'baseline'].includes(k) ? 100 : undefined}
                value={a[k]}
                onChange={(e) =>
                  set({
                    ...a,
                    [k]: Math.min(
                      ['pilot', 'baseline'].includes(k) ? 100 : Infinity,
                      Math.max(0, e.target.valueAsNumber || 0),
                    ),
                  })
                }
              />
            </label>
          ))}
        </section>
        <section className="on-panel">
          <h2>Annual capacity</h2>
          <dl>
            {[
              ['Reviews avoided', number((avoided * a.volume) / 1000)],
              ['Routing hours', number(routing * factor)],
              ['Routing capacity', '$' + number(routing * factor * a.rate)],
              ['Preparation on remaining cases', '$' + number(prepared * factor * a.rate)],
              [
                'Capacity value after entered costs',
                '$' + number((routing + prepared) * factor * a.rate - a.cost),
              ],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p>
            Cash savings require reduced overtime, contractor spend, or funded hiring. Enter
            inference, sampling, infrastructure and operating costs. Revenue lift requires its own
            measurement.
          </p>
          <h4>Scope the pilot</h4>
          <p>
            Amazon reports over 12 million sales-ready listings created by independent sellers with
            generative AI in 2025. Establish eligible pilot volume with the customer.
          </p>
          <a
            target="_blank"
            rel="noreferrer"
            href="https://cdn-sellingpartners.aboutamazon.com/4a/56/1656c4eb463490da300204f1794d/small-business-empowerment-report-2025.pdf"
          >
            Amazon’s 2025 report ↗
          </a>
          {observed && (
            <>
              <details>
                <summary>Review assignments</summary>
                {observed.assignments.map((c) => (
                  <label key={c.id}>
                    {c.sku} · {c.category}
                    <select
                      value={c.assigned}
                      onChange={(e) =>
                        void assign(c.id, c.version, e.target.value).catch(() =>
                          report('Assignment unavailable.'),
                        )
                      }
                    >
                      <option>Maya</option>
                      <option>Unassigned</option>
                    </select>
                  </label>
                ))}
                {message && <p role="status">{message}</p>}
              </details>
              <h4>Local rehearsal activity</h4>
              <p>
                {observed.submittedCases} submission cases · {observed.shopperReports} shopper
                reports · {number(observed.activeMinutes)} recorded active reviewer minutes.
              </p>
              <p>
                Mean time to first local review ·{' '}
                {observed.queueMinutes === null
                  ? 'Awaiting first review'
                  : number(observed.queueMinutes) + ' min'}
                <br />
                Mean seller-request wait ·{' '}
                {observed.sellerWaitMinutes === null
                  ? 'Awaiting first disposition'
                  : number(observed.sellerWaitMinutes) + ' min'}
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
