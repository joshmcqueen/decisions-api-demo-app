import { useState } from 'react';
import { ClipboardCheck, MessagesSquare, SlidersHorizontal, ChevronDown } from 'lucide-react';

const defaults = {
  volume: 12_000_000, baseline: 5, pilot: 4, before: 20, after: 15, rate: 60, cost: 0,
};
const labels: Record<keyof typeof defaults, string> = {
  volume: 'Eligible submissions per year',
  baseline: 'Baseline review rate (%)',
  pilot: 'Pilot review rate (%)',
  before: 'Baseline minutes per case',
  after: 'Prepared minutes per case',
  rate: 'Loaded hourly cost ($)',
  cost: 'Annual AI and operating costs ($)',
};
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
});

export function Pilot() {
  const [scenario, setScenario] = useState(defaults);
  const { volume, baseline, pilot, before, after, rate, cost } = scenario;
  const baselineCases = volume * baseline / 100;
  const pilotCases = volume * pilot / 100;
  const baselineHours = baselineCases * before / 60;
  const routedHours = pilotCases * before / 60;
  const preparedHours = pilotCases * after / 60;
  const freedHours = baselineHours - preparedHours;
  const netValue = freedHours * rate - cost;
  const chartMax = Math.max(baselineHours, routedHours, preparedHours, 1);
  const stages = [
    { label: 'Baseline', hours: baselineHours },
    { label: 'With seller corrections', hours: routedHours },
    { label: 'With corrections and prepared reviews', hours: preparedHours },
  ];

  return (
    <div className="pilot">
      <header className="on-title">
        <div>
          <p className="on-kicker">SELLING PARTNER EXPERIENCE</p>
          <h1>Pilot impact</h1>
          <p>US small appliances · Illustrative annual scenario</p>
        </div>
      </header>

      <section className="pilot-hero" aria-label="Modeled annual impact">
        <div className="pilot-opportunity">
          <h2>Potential annual capacity value</h2>
          <strong className="pilot-value">{money.format(netValue)}</strong>
          <p>{number.format(Math.abs(freedHours))} reviewer hours {freedHours < 0 ? 'added' : 'freed'} at {money.format(rate)}/hour</p>
          <small>
            Assumes {number.format(volume)} eligible submissions per year.
            {' '}{cost === 0 ? 'Before AI and operating costs.' : 'After ' + money.format(cost) + ' in annual AI and operating costs.'}
          </small>
        </div>
        <figure className="pilot-chart">
          <figcaption>Annual reviewer hours</figcaption>
          {stages.map(({ label, hours }) => (
            <div className="pilot-stage" key={label}>
              <div><span>{label}</span><strong>{number.format(hours)}</strong></div>
              <div className="pilot-track" aria-hidden="true">
                <span style={{ width: (hours / chartMax) * 100 + '%' }} />
              </div>
            </div>
          ))}
        </figure>
      </section>

      <div className="pilot-drivers">
        <section className="on-panel pilot-driver">
          <p className="pilot-source"><ClipboardCheck size={17} aria-hidden="true" /> Decisions API</p>
          <h2>Catch listing issues before review</h2>
          <p>Sellers see which field needs attention and how to fix it, such as replacing a photo that shows the wrong color.</p>
          <div className="pilot-driver-value">
            <strong>{money.format((baselineHours - routedHours) * rate)}</strong>
            <span>{number.format(Math.abs(baselineCases - pilotCases))} {baselineCases >= pilotCases ? 'fewer' : 'additional'} specialist reviews per year</span>
          </div>
          <small>{number.format(baseline * 10)} → {number.format(pilot * 10)} reviews per 1,000 submissions</small>
        </section>
        <section className="on-panel pilot-driver">
          <p className="pilot-source"><MessagesSquare size={17} aria-hidden="true" /> ChatGPT Enterprise</p>
          <h2>Prepare the cases that remain</h2>
          <p>Reviewers can inspect the disputed claim, check the cited SKU evidence and weigh a recommended action before deciding.</p>
          <div className="pilot-driver-value">
            <strong>{money.format((routedHours - preparedHours) * rate)}</strong>
            <span>{number.format(Math.abs(before - after))} {before >= after ? 'fewer' : 'additional'} minutes on each of {number.format(pilotCases)} cases</span>
          </div>
          <small>{number.format(before)} → {number.format(after)} active minutes per review</small>
        </section>
      </div>

      <section className="pilot-proof">
        <h2>What would turn capacity into cash savings?</h2>
        <p>Compare escalation rates and active review time with a control group. Sample cleared listings for missed defects. Count savings when freed hours reduce overtime, contractor spend or planned hiring, then deduct Enterprise, API and operating costs.</p>
      </section>

      <details className="on-panel pilot-assumptions">
        <summary><SlidersHorizontal size={18} aria-hidden="true" /> Edit scenario assumptions <ChevronDown size={18} aria-hidden="true" /></summary>
        <div className="pilot-inputs">
          {(Object.keys(labels) as (keyof typeof defaults)[]).map((key) => {
            const max = key === 'baseline' || key === 'pilot' ? 100 : undefined;
            return (
              <label key={key}>
                {labels[key]}
                <input type="number" min="0" max={max} step="any" value={scenario[key]}
                  onChange={(event) => setScenario({ ...scenario, [key]: Math.min(max ?? Infinity, Math.max(0, event.target.valueAsNumber || 0)) })}
                />
              </label>
            );
          })}
        </div>
        <p>Amazon reports over 12 million AI-assisted listings created by independent sellers in 2025. The eligible US small-appliance volume needs to be measured separately. <a href="https://www.aboutamazon.com/news/small-business/amazon-2025-small-business-empowerment-report" target="_blank" rel="noreferrer">Amazon’s 2025 report ↗</a></p>
      </details>
    </div>
  );
}
