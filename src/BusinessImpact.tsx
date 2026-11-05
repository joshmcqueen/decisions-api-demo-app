import { ArrowDownRight, ArrowUpRight, ChartNoAxesCombined, CircleHelp } from 'lucide-react';
import { useId } from 'react';
import type { Run } from '../shared/domain.ts';
import { projectImpact } from '../shared/business-impact.ts';

export type ScaleAssumptions = { annualListings: string; checksPerListing: string };
const scenarios = [
  { label: 'Seller portfolio', listings: '1000000' },
  { label: 'Large marketplace', listings: '100000000' },
  { label: 'Global scale', listings: '1000000000' },
];
const number = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
const dollars = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: Math.abs(value) < 1 ? 2 : 0 }).format(value);
const unitCost = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 9 }).format(value);

export function BusinessImpact({ runs, busy, assumptions, onChange, saved = false }: {
  runs: Run[]; busy: boolean; assumptions: ScaleAssumptions; onChange: (next: ScaleAssumptions) => void; saved?: boolean;
}) {
  const id = useId();
  const listings = Number(assumptions.annualListings), checks = Number(assumptions.checksPerListing);
  const valid = Number.isInteger(listings) && listings >= 1 && listings <= 1e12 && Number.isInteger(checks) && checks >= 1 && checks <= 100;
  const impact = busy ? null : projectImpact(runs, listings, checks);
  const extra = impact != null && impact.annualSavings < 0;
  const zero = impact?.annualSavings === 0;
  const maxSpend = impact ? Math.max(impact.annualResponses, impact.annualDecisions) : 0;
  return <section className="business-impact" aria-labelledby={`${id}-title`}>
    <div className="impact-heading"><div><span className="eyebrow"><ChartNoAxesCombined size={15}/>THE BUSINESS CASE</span><h3 id={`${id}-title`}>Small difference. Marketplace-scale impact.</h3><p>What does the cost of one check mean across a year of listings?</p></div><span className="scenario-badge">Fictional volume scenario</span></div>
    <div className="impact-assumptions">
      <div className="impact-presets" role="group" aria-label="Volume scenario">{scenarios.map(s => <button key={s.listings} aria-pressed={assumptions.annualListings === s.listings} onClick={() => onChange({ ...assumptions, annualListings: s.listings })}>{s.label}<span>{number(Number(s.listings))} / year</span></button>)}</div>
      <div className="impact-inputs"><label htmlFor={`${id}-listings`}>New listings / year<input id={`${id}-listings`} type="number" min="1" max="1000000000000" step="1" value={assumptions.annualListings} onChange={e => onChange({ ...assumptions, annualListings: e.target.value })}/></label><span className="impact-times" aria-hidden="true">×</span><label htmlFor={`${id}-checks`}>Checks / listing<input id={`${id}-checks`} type="number" min="1" max="100" step="1" value={assumptions.checksPerListing} onChange={e => onChange({ ...assumptions, checksPerListing: e.target.value })}/></label><div className="impact-check-total"><span>Annual listing checks</span><strong>{valid ? number(listings * checks) : '—'}</strong></div></div>
      <p className="impact-assumption-note">Illustrative volumes, not Amazon marketplace statistics. Checks include initial submission, edits, and reruns; each check covers all five criteria.</p>
    </div>
    {impact ? <>
      <div className={`impact-outcome ${extra ? 'extra-cost' : ''}`}>
        <div className="impact-hero"><span className="impact-kicker">{zero ? 'PROJECTED ANNUAL DIFFERENCE' : extra ? 'PROJECTED ADDITIONAL ANNUAL COST' : 'PROJECTED ANNUAL SAVINGS'}</span><strong data-testid="annual-impact">{dollars(Math.abs(impact.annualSavings))}</strong><p>{zero ? 'The measured inference costs are equal.' : <>in inference {extra ? 'spend' : 'savings'} with Decisions vs. {impact.baseline.model === 'gpt-6.1-sol' ? 'GPT-6.1 Sol' : 'GPT-6 Luna'} vision checks.</>}</p><span className="impact-reduction">{extra ? <ArrowUpRight size={17}/> : <ArrowDownRight size={17}/>} {impact.reduction == null ? 'Zero-cost LLM baseline' : `${Math.abs(impact.reduction * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}% ${extra ? 'higher' : 'lower'} inference cost`}</span></div>
        <div className="impact-periods">{[['Per month', impact.monthlySavings], ['Per quarter', impact.quarterlySavings], ['Per year', impact.annualSavings]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{dollars(Math.abs(Number(value)))}</strong><small>{zero ? 'difference' : extra ? 'additional cost' : 'projected savings'}</small></div>)}</div>
      </div>
      <div className="impact-chart" aria-label="Projected annual inference spend"><div className="impact-chart-heading"><strong>Same volume. Different inference spend.</strong><span>USD / year</span></div>{[
        { label: `Standard LLM · ${impact.baseline.model === 'gpt-6.1-sol' ? 'GPT-6.1 Sol' : 'GPT-6 Luna'}`, value: impact.annualResponses, style: 'llm' },
        { label: 'Decisions API · GPT-6 Luna', value: impact.annualDecisions, style: 'decisions' },
      ].map(row => <div className="impact-bar-row" key={row.style}><div><span>{row.label}</span><strong>{dollars(row.value)}</strong></div><div className="impact-bar-track"><div className={`impact-bar ${row.style}`} style={{ width: `${maxSpend > 0 ? row.value / maxSpend * 100 : 0}%` }}/></div></div>)}</div>
      <details className="impact-method"><summary>Based on {impact.pairs} measured {impact.pairs === 1 ? 'pair' : 'pairs'} · See the math</summary><p>Average cost per check: Decisions {unitCost(impact.decisionsPerCheck)}; standard LLM {unitCost(impact.responsesPerCheck)} ({impact.baseline.settings.effort} reasoning). Difference: {unitCost(impact.responsesPerCheck - impact.decisionsPerCheck)} × {number(impact.annualChecks)} annual checks = {dollars(impact.annualSavings)} annual savings. Monthly = annual ÷ 12; quarterly = annual ÷ 4.</p></details>
    </> : <div className="impact-empty" role="status"><ChartNoAxesCombined size={24}/><div><strong>{!valid ? 'Enter a valid volume to calculate the impact.' : busy ? 'Measuring the cost of each approach…' : runs.length ? 'A complete, costed comparison is needed.' : 'Run a comparison. See what it means at scale.'}</strong><p>{!valid ? 'Use 1–1 trillion whole listings and 1–100 checks per listing.' : busy ? 'Your projection will appear when the comparison finishes.' : 'Compare approaches or finish repeat runs to turn measured per-check costs into a business case. Failed calls and missing costs cannot support a projection.'}</p></div></div>}
    <p className="impact-footnote"><CircleHelp size={14}/><span>{saved && 'Saved comparison; rerun to reflect the current draft or settings. '}Directional estimate using measured API costs and fictional volumes, held constant over the year. Inference only; excludes infrastructure and asset generation. Small samples do not establish production accuracy or guaranteed savings.</span></p>
  </section>;
}
