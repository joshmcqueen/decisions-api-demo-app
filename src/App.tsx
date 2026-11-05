import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, AudioLines, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, Circle, CircleHelp, Clock3, Code2, Coffee, ExternalLink, FlaskConical, ImageIcon, Layers3, LoaderCircle, RotateCcw, Settings2, ShieldCheck, Sparkles, Square, X, AlertCircle, BookOpen, History, SlidersHorizontal } from 'lucide-react';
import { CHECK_IDS, CHECK_LABELS, CHECK_HELP, DEFAULT_SETTINGS, EFFORTS, STATUS_LABEL, formatMs, money, validSettings, type Asset, type Engine, type Fixture, type Listing, type Product, type Run, type Settings } from '../shared/domain.ts';
import { csv, summarize } from '../shared/statistics.ts';

type Config = { keyConfigured: boolean; assets: Asset[]; questionVersion: string; questions: unknown; guidelines: { title: string; url: string; description: string; verified: boolean }[] };
type Dialog = 'settings' | 'guidelines' | 'history' | 'repeat' | 'inspector' | null;
const clone = <T,>(v: T): T => structuredClone(v);
function loadSettings(): Settings { try { const value = JSON.parse(localStorage.getItem('listing-checker-settings') ?? 'null'); return validSettings(value) ? value : DEFAULT_SETTINGS; } catch { return DEFAULT_SETTINGS; } }
function download(name: string, contents: string, type: string) { const url = URL.createObjectURL(new Blob([contents], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function ProductImage({ asset, className = '' }: { asset?: Asset; className?: string }) {
  const [failed,setFailed] = useState(false);
  useEffect(() => setFailed(false), [asset?.id, asset?.available]);
  return asset?.available && !failed ? <img className={className} src={`/products/${asset.file}`} alt={asset.label} onError={() => setFailed(true)} /> : <div className={`photo-placeholder ${className}`}><ImageIcon size={24}/><span>Photo preparation pending</span></div>;
}
function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const items = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]')];
        const first=items[0],last=items.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handler); const old = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown',handler); document.body.style.overflow = old; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`modal ${wide ? 'wide' : ''}`}><header><div><span className="eyebrow">LISTING CHECKER</span><h2>{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></header>{children}</div></div>;
}
function StatusIcon({ outcome }: { outcome?: string }) { return outcome === 'match' ? <CheckCircle2 size={18} className="green"/> : outcome === 'mismatch' ? <AlertCircle size={18} className="amber"/> : outcome === 'insufficient_evidence' ? <CircleHelp size={18} className="amber"/> : <Circle size={18} className="muted-icon"/>; }

export default function App() {
  const [config,setConfig] = useState<Config>();
  const [products,setProducts] = useState<Product[]>([]);
  const [fixtures,setFixtures] = useState<Fixture[]>([]);
  const [listing,setListing] = useState<Listing>();
  const [preset,setPreset] = useState('headphones-attention');
  const [settings,setSettings] = useState<Settings>(loadSettings);
  const [dialog,setDialog] = useState<Dialog>(null);
  const [runs,setRuns] = useState<Run[]>([]);
  const [display,setDisplay] = useState<Partial<Record<Engine,Run>>>({});
  const [inspected,setInspected] = useState<Run>();
  const [active,setActive] = useState<Engine[]>([]);
  const [busy,setBusy] = useState(false);
  const [compare,setCompare] = useState(false);
  const [stale,setStale] = useState(false);
  const [notice,setNotice] = useState('');
  const [loadError,setLoadError] = useState('');
  const [elapsed,setElapsed] = useState(0);
  const [repetitions,setRepetitions] = useState(5);
  const [progress,setProgress] = useState({ done: 0, total: 0 });
  const [batchId,setBatchId] = useState('');
  const sequence = useRef(0), controllers = useRef<AbortController[]>([]), started = useRef(0);
  const busyRef = useRef(false);
  const product = products.find(p => p.id === listing?.productId);
  const asset = config?.assets.find(a => a.id === listing?.imageId);
  const currentFixture = fixtures.find(f => f.id === preset);
  const currentRun = display.decisions;
  const batchRuns = runs.filter(r => r.batchId === batchId);

  async function refreshConfig() { const r = await fetch('/api/config'); if (!r.ok) throw new Error('Configuration unavailable'); const c = await r.json(); setConfig(c); return c as Config; }
  async function load() {
    setLoadError('');
    try { const [,data] = await Promise.all([refreshConfig(), fetch('/api/fixtures').then(r => { if(!r.ok) throw new Error(); return r.json(); })]); setProducts(data.products); setFixtures(data.fixtures); setListing(l => l ?? clone(data.fixtures.find((f: Fixture) => f.id === 'headphones-attention').listing)); }
    catch { setLoadError('The local server is unavailable. Start the app with npm run dev, then retry.'); }
  }
  useEffect(() => { void load(); return () => controllers.current.forEach(c => c.abort()); }, []);
  useEffect(() => { localStorage.setItem('listing-checker-settings', JSON.stringify(settings)); }, [settings]);
  useEffect(() => { if (!busy) return; const timer = setInterval(() => setElapsed(performance.now() - started.current),100); return () => clearInterval(timer); },[busy]);
  function cancel() { sequence.current++; controllers.current.forEach(c => c.abort()); controllers.current=[]; busyRef.current=false; setBusy(false); setActive([]); }
  function update(next: Listing) { cancel(); setListing(next); setStale(Boolean(display.decisions || display.responses)); setNotice(''); }
  function selectFixture(f: Fixture) { cancel(); setPreset(f.id); setListing(clone(f.listing)); setDisplay({}); setStale(false); setNotice(''); }
  function changeSettings(next: Settings) { cancel(); setSettings(next); setStale(Boolean(display.decisions || display.responses)); }
  function saveRun(run: Run) { setRuns(previous => [...previous,run]); }
  async function request(engine: Engine, snapshot: Listing, selected: Settings, token: number, metadata: Partial<Run> = {}) {
    const controller = new AbortController(); controllers.current.push(controller);
    const start = performance.now(); setActive(a => [...a.filter(x=>x!==engine),engine]);
    try {
      const response = await fetch('/api/preflight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine, listing: snapshot, settings: selected }), signal: controller.signal });
      const data = await response.json();
      if (token !== sequence.current) return;
      if (!response.ok) throw new Error(data.error ?? 'Request unavailable.');
      const run: Run = { ...data, ...metadata, roundTripMs: performance.now()-start };
      saveRun(run); setDisplay(d => ({...d,[engine]:run})); return run;
    } catch (error) {
      if (controller.signal.aborted || token !== sequence.current) return;
      const message = error instanceof Error ? error.message : 'Request unavailable.';
      const run: Run = { id: crypto.randomUUID(), engine, settings: engine === 'decisions' ? DEFAULT_SETTINGS : selected, model: engine === 'decisions' ? 'gpt-6-luna' : selected.model, timestamp: new Date().toISOString(), fingerprint: `unavailable:${JSON.stringify(snapshot)}`, questionVersion: config?.questionVersion ?? '', fixtureId:null, listing:snapshot, checks:[], status:'error', sdkMs:null, roundTripMs:performance.now()-start, usage:null, cost:null, raw:null, request:null, error:message, ...metadata };
      saveRun(run); setDisplay(d => ({...d,[engine]:run})); return run;
    } finally { controllers.current = controllers.current.filter(c => c !== controller); if(token === sequence.current) setActive(a => a.filter(x=>x!==engine)); }
  }
  function begin(): number { cancel(); const token=sequence.current; busyRef.current=true; setBusy(true); started.current=performance.now(); setElapsed(0); setStale(false); setNotice(''); setDisplay({}); return token; }
  async function runCheck(comparison: boolean) {
    if (!listing || busyRef.current) return;
    const snapshot=clone(listing), selected=clone(settings), token=begin(); setCompare(comparison);
    await Promise.allSettled((comparison ? ['decisions','responses'] as Engine[] : ['decisions'] as Engine[]).map(e => request(e,snapshot,selected,token,{mode:'live'})));
    if(token === sequence.current) { busyRef.current=false; setBusy(false); }
    void refreshConfig().catch(()=>{});
  }
  async function repeat() {
    if (!listing || busyRef.current) return;
    const snapshot=clone(listing), selected=clone(settings), count=Math.max(1,Math.min(20,Math.trunc(repetitions)||5)); setRepetitions(count);
    const token=begin(), id=crypto.randomUUID(); setBatchId(id); setCompare(true); setProgress({done:0,total:count*2});
    for(let i=0;i<count;i++) {
      for(const engine of (i%2 ? ['responses','decisions'] : ['decisions','responses']) as Engine[]) {
        if(token !== sequence.current) return;
        await request(engine,snapshot,selected,token,{mode:'repeat',batchId:id,repetition:i+1});
        if(token !== sequence.current) return;
        setProgress(p => ({...p,done:p.done+1}));
      }
    }
    if(token===sequence.current) { busyRef.current=false; setBusy(false); setNotice('Repeat runs complete. Export the results to keep them.'); }
  }
  function exportRuns(type: 'json'|'csv') {
    const name=`listing-checker-${new Date().toISOString().replaceAll(':','-')}`;
    if(type==='csv') download(`${name}.csv`,csv(runs),'text/csv');
    else download(`${name}.json`,JSON.stringify({exportedAt:new Date().toISOString(),notes:'Exploratory synthetic fixture measurements; estimated costs, not billed amounts. Annual scale requires separate assumptions.',runs},null,2),'application/json');
  }

  const primaryStatus = currentRun?.status;
  return <>
    <header className="app-header"><a className="brand" href="/" aria-label="Listing Checker home"><span className="brand-symbol"><CheckCheck size={23}/></span><span><strong>Listing Checker</strong></span></a><div className="header-right"><span className="demo-label"><span/>INDEPENDENT DEMO</span><button className="text-button" onClick={()=>setDialog('history')}><History size={16}/>Run history{runs.length>0&&<span className="count">{runs.length}</span>}</button><button className="icon-button" aria-label="Settings" onClick={()=>setDialog('settings')}><Settings2 size={19}/></button></div></header>
    <main className="page">
      <div className="page-heading"><div><div className="eyebrow"><span className="tiny-line"/>SELLER WORKSPACE</div><h1>Help sellers get listings right.</h1><p>Catch inconsistencies. Make a quick correction. Move forward with confidence.</p></div><button className="outline-button guide-button" onClick={()=>setDialog('guidelines')}><BookOpen size={16}/>Listing guidelines<ArrowUpRight size={15}/></button></div>
      {loadError&&<div className="banner error" role="alert">{loadError}<button onClick={()=>void load()}>Retry</button></div>}
      {!loadError&&!listing&&<div className="loading-page"><LoaderCircle className="spin"/>Opening the workspace…</div>}
      {listing&&product&&<div className="workspace">
        <aside className="product-sidebar"><div className="sidebar-heading"><span className="eyebrow">YOUR EXAMPLES</span><span className="count">03</span></div><p className="sidebar-copy">Three products. A few easy-to-miss details.</p>
          <div className="product-list">{products.map((p,i)=><button key={p.id} className={`product-card ${p.id===product.id?'selected':''}`} onClick={()=>selectFixture(fixtures.find(f=>f.id===`${p.id}-attention`)!)} aria-pressed={p.id===product.id}><div className="product-thumb"><ProductImage asset={config?.assets.find(a=>a.id===p.thumbnail)}/></div><div className="product-card-text"><span className="product-index">0{i+1} / {p.category}</span><strong>{p.name}</strong><span>{p.id==='headphones'?'A different shade':p.id==='coffee'?'A claim worth checking':'A little extra promotion'}</span></div><ChevronRight size={16} className="product-chevron"/></button>)}</div>
          <div className="sidebar-note"><div className="note-icon"><FlaskConical size={17}/></div><strong>A small, real experiment.</strong><p>Fictional products.<br/>Generated photos.<br/>Live checks.</p><button className="link-button" onClick={()=>setDialog('repeat')}>Explore repeat runs<ArrowRight size={14}/></button></div>
        </aside>
        <section className="editor panel" aria-label="Listing editor"><div className="panel-heading"><div><span className="eyebrow">LISTING DRAFT</span><h2>{product.name}</h2></div><span className="draft-badge">Draft</span></div>
          <div className="preset-switch" role="group" aria-label="Example version">{(['attention','consistent'] as const).map(v=><button key={v} className={currentFixture?.variant===v?'active':''} onClick={()=>selectFixture(fixtures.find(f=>f.id===`${product.id}-${v}`)!)}>{v==='attention'?<CircleHelp size={14}/>:<Check size={14}/>} {v==='attention'?'Needs-attention example':'Consistent example'}</button>)}</div>
          <div className="editor-content"><div className="image-column"><div className="field-heading"><label>Main product photo</label><span>01 / 01</span></div><div className="main-photo"><ProductImage asset={asset}/><span className="photo-tag"><ImageIcon size={12}/>MAIN IMAGE</span></div><div className="image-picker" role="group" aria-label="Choose main photo">{product.imageIds.map(id=>{const a=config?.assets.find(a=>a.id===id);return <button key={id} className={`image-option ${listing.imageId===id?'chosen':''}`} onClick={()=>update({...listing,imageId:id})} aria-label={`Use ${a?.label}`} aria-pressed={listing.imageId===id}><ProductImage asset={a}/>{listing.imageId===id&&<span><Check size={11}/></span>}</button>;})}<p>Select a preloaded photo<br/><strong>{asset?.label}</strong></p></div><p className="helper">Synthetic product imagery · Sunburst</p></div>
            <div className="text-fields"><div className="field-heading"><label htmlFor="listing-title">Product title</label><span>{listing.title.length} characters</span></div><textarea id="listing-title" className="title-input" rows={3} maxLength={500} value={listing.title} onChange={e=>update({...listing,title:e.target.value})}/><div className="field-heading bullets-heading"><label>Key product features</label><span>3 bullets</span></div>{listing.bullets.map((b,i)=><div className="bullet-field" key={i}><span className="bullet-number">0{i+1}</span><textarea aria-label={`Bullet ${i+1}`} rows={3} maxLength={1000} value={b} onChange={e=>update({...listing,bullets:listing.bullets.map((v,n)=>n===i?e.target.value:v)})}/></div>)}</div>
          </div>
          <details className="reference-facts"><summary><Layers3 size={16}/><span>Product reference facts</span><span className="reference-caption">The source for this example</span><ChevronDown size={15}/></summary><div className="facts-grid">{Object.entries(product.facts).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</div><p>Read-only synthetic specifications. These facts are included in each check.</p></details>
          <div className="editor-bottom"><span><span className="small-dot"/>Changes stay in this workspace</span><button className="text-button" onClick={()=>selectFixture(currentFixture!)}><RotateCcw size={13}/>Reset example</button></div>
        </section>
        <aside className="results panel" aria-label="Listing results"><div className="panel-heading"><div><span className="eyebrow">A SECOND LOOK</span><h2>Listing check</h2></div><ShieldCheck size={23} className="ink-icon"/></div>
          <div className={`result-summary ${stale?'stale':primaryStatus??''}`} aria-live="polite">{busy&&active.includes('decisions')?<><span className="summary-icon"><LoaderCircle className="spin" size={21}/></span><h3>Taking a closer look…</h3><p>Checking your photo and listing together.</p></>:<><span className="summary-icon">{primaryStatus==='passed'?<CheckCheck size={22}/>:primaryStatus==='attention'?<AlertCircle size={22}/>:primaryStatus==='error'?<CircleHelp size={22}/>:<Sparkles size={22}/>}</span><h3>{stale?'Your draft has changed':primaryStatus?STATUS_LABEL[primaryStatus]:'Ready for a second look?'}</h3><p>{stale?'Run another check to review these changes.':primaryStatus==='passed'?'The five checks found no inconsistencies.':primaryStatus==='attention'?'A detail needs your attention before submission.':primaryStatus==='error'?currentRun?.error:'Check the details before you submit.'}</p></>}</div>
          {stale&&<div className="stale-label">Previous results · rerun required</div>}
          <div className={`check-list ${stale?'dimmed':''}`}>{CHECK_IDS.map(id=>{const c=currentRun?.checks.find(c=>c.id===id);return <div className={`check-row ${c?.outcome==='mismatch'?'has-issue':''}`} key={id}><StatusIcon outcome={c?.outcome}/><div><span>{CHECK_LABELS[id]}</span>{c?.outcome==='mismatch'&&<p>{CHECK_HELP[id]}</p>}{c?.outcome==='insufficient_evidence'&&<p>There isn’t enough clear evidence. Review this detail.</p>}</div></div>;})}</div>
          <div className="result-actions"><button className="primary-button" disabled={busy||!listing.title.trim()||listing.bullets.some(b=>!b.trim())} onClick={()=>void runCheck(false)}>{busy?<LoaderCircle size={17} className="spin"/>:<CheckCheck size={18}/>}Check listing<ArrowRight size={17}/></button><button className="outline-button comparison-button" disabled={busy||!listing.title.trim()||listing.bullets.some(b=>!b.trim())} onClick={()=>void runCheck(true)}><SlidersHorizontal size={16}/>Compare approaches</button>{busy&&<button className="link-button cancel-button" onClick={()=>{cancel();setNotice('Stopped. Completed runs remain in history.');}}><Square size={12}/>Stop checking</button>}</div>
          <div className="results-footnote"><ShieldCheck size={14}/><p>A preflight check, not listing approval.<br/>Existing marketplace rules still apply.</p></div>
        </aside>
        <div className="workspace-bottom"><div className="measurement-card"><div className="measurement-heading"><div><span className="eyebrow">MEASURE, DON’T GUESS</span><h3>{compare?'Two approaches. The same listing.':'Real checks. Real response times.'}</h3></div><button className="text-button" onClick={()=>setDialog('repeat')}><FlaskConical size={15}/>Repeat runs<ChevronRight size={14}/></button></div>
            {compare?<div className="comparison-table"><div className="comparison-row table-labels"><span>APPROACH</span><span>COMPLETION</span><span>EST. COST / CHECK</span><span>RESULT</span></div>{(['decisions','responses'] as Engine[]).map(e=>{const r=display[e],loading=active.includes(e),selected=r?.settings??settings;return <div key={e} className="comparison-row"><span><strong>{e==='decisions'?'Decisions':'Standard LLM call'}</strong><small>{e==='decisions'?'GPT-6 Luna':`${selected.model==='gpt-6-luna'?'GPT-6 Luna':'GPT-6.1 Sol'} · ${selected.effort==='none'?'no reasoning':selected.effort+' reasoning'}`}</small></span><span className="metric-value">{loading?<><LoaderCircle size={13} className="spin"/>{formatMs(elapsed)}</>:formatMs(r?.sdkMs)}<small>SDK round trip</small></span><span className="metric-value">{r?money(r.cost?.usd):'—'}<small>USD · inference only</small></span><span>{r?<button className={`status-chip ${r.status}`} onClick={()=>{setInspected(r);setDialog('inspector');}}>{STATUS_LABEL[r.status]}<ArrowUpRight size={12}/></button>:<span className="helper">{loading?'Checking…':'Not run'}</span>}</span></div>;})}<p className="measurement-note">{stale?'Previous results; rerun for the updated draft or settings. ':''}{(display.responses?.settings.model??settings.model)==='gpt-6-luna'?'Same model, different endpoints.':'Different models and endpoints; this comparison changes both.'} Identical product evidence and five check definitions. Live calls run concurrently.</p></div>:<div className="single-measurement"><div><Clock3 size={18}/><span><strong>{busy?formatMs(elapsed):formatMs(currentRun?.sdkMs)}</strong><small>SDK round trip</small></span></div><div><span className="dollar-symbol">$</span><span><strong>{currentRun?money(currentRun.cost?.usd):'—'}</strong><small>Estimated inference cost</small></span></div><div><span className={`connection-dot ${config?.keyConfigured?'ready':''}`}/><span><strong>{config?.keyConfigured?'API key configured':'Add your API key'}</strong><small>{config?.keyConfigured?'Live calls · no simulated results':'Server .env · never in the browser'}</small></span></div></div>}
            {(currentRun||display.responses)&&<button className="inspector-link" onClick={()=>{setInspected(currentRun??display.responses);setDialog('inspector');}}><Code2 size={14}/>Inspect request & response<ArrowUpRight size={13}/></button>}
          </div><div className="workflow-note"><span className="note-icon"><ArrowRight size={18}/></span><div><strong>A correction, not a roadblock.</strong><p>Find a conflicting detail, update your draft, then check again.</p></div></div></div>
      </div>}
      {notice&&<div role="status" className="toast"><CheckCircle2 size={16}/>{notice}<button aria-label="Dismiss notification" onClick={()=>setNotice('')}><X size={14}/></button></div>}
      <footer className="page-footer"><span>Independent demo · Synthetic products · No marketplace affiliation</span><span>Built with OpenAI<span className="footer-dot">·</span><button onClick={()=>setDialog('guidelines')}>Sources & assumptions<ArrowUpRight size={12}/></button></span></footer>
    </main>

    {dialog==='settings'&&<Modal title="Comparison settings" onClose={()=>setDialog(null)}><p className="modal-intro">Choose the standard LLM call to compare with Decisions. Settings apply to future runs.</p><div className="fixed-engine"><span className="note-icon"><CheckCheck size={20}/></span><div><strong>Decisions API</strong><p>GPT-6 Luna · Bounded decisions</p></div><span className="draft-badge">Fixed</span></div><label className="setting-label" htmlFor="comparison-model">Comparison model</label><select id="comparison-model" value={settings.model} onChange={e=>{const model=e.target.value as Settings['model'];changeSettings({model,effort:model==='gpt-6-luna'?'none':'medium'});}}><option value="gpt-6-luna">GPT-6 Luna — same-model comparison</option><option value="gpt-6.1-sol">GPT-6.1 Sol — larger general model</option></select><label className="setting-label" htmlFor="reasoning">Reasoning effort</label><select id="reasoning" value={settings.effort} onChange={e=>changeSettings({...settings,effort:e.target.value as Settings['effort']})}>{EFFORTS[settings.model].map(e=><option key={e} value={e}>{e==='none'?'None — fastest baseline':e[0].toUpperCase()+e.slice(1)}</option>)}</select><div className="info-box"><CircleHelp size={17}/><p>Both approaches use the same product evidence and check definitions. Responses returns compact structured output. Changing the model or reasoning changes the comparison.</p></div><div className="api-state"><span className={`connection-dot ${config?.keyConfigured?'ready':''}`}/>{config?.keyConfigured?'Server API key is configured.':'Add OPENAI_API_KEY to the project .env file.'}<button className="link-button" onClick={()=>void refreshConfig()}>Refresh</button></div><button className="primary-button modal-done" onClick={()=>setDialog(null)}>Done<Check size={16}/></button></Modal>}
    {dialog==='guidelines'&&<Modal title="Sources & assumptions" onClose={()=>setDialog(null)}><p className="modal-intro">A focused consistency check for the seller listing workflow. It complements existing validation and listing tools.</p><div className="info-box"><BookOpen size={18}/><p>White background and overlay checks are narrow demo criteria. Exact category-specific policies and title limits require verification. Passing these checks is not a compliance guarantee.</p></div><div className="guideline-list">{config?.guidelines.map(g=><a href={g.url} key={g.url} target="_blank" rel="noreferrer"><div><strong>{g.title}</strong><p>{g.description}</p><span>{g.verified?'Public guidance reviewed':'Seller Central · verify full policy text'}</span></div><ExternalLink size={16}/></a>)}</div><p className="fine-print">Reference facts and all listings are fictional. Images are generated with GPT Image 2.6 Sunburst. No seller or customer data is used. No listing is submitted or published.</p></Modal>}
    {dialog==='history'&&<Modal title="Run history" onClose={()=>setDialog(null)} wide><div className="modal-toolbar"><p>Results live in this tab. Export them before refreshing.</p><div><button className="outline-button" disabled={!runs.length} onClick={()=>exportRuns('csv')}><ArrowDownToLine size={14}/>CSV</button><button className="outline-button" disabled={!runs.length} onClick={()=>exportRuns('json')}><ArrowDownToLine size={14}/>JSON</button></div></div>{!runs.length?<div className="empty-state"><History size={30}/><h3>Your experiment starts here.</h3><p>Check a listing or compare approaches to capture a real result.</p></div>:<div className="history-table"><table><thead><tr><th>Time / product</th><th>Approach</th><th>Result</th><th>SDK time</th><th>Est. USD</th><th>Details</th></tr></thead><tbody>{[...runs].reverse().map(r=><tr key={r.id}><td>{new Date(r.timestamp).toLocaleTimeString()}<small>{products.find(p=>p.id===r.listing.productId)?.name}</small></td><td>{r.engine==='decisions'?'Decisions':'Responses'}<small>{r.model} · {r.engine==='responses'?r.settings.effort:'bounded decisions'}</small></td><td><span className={`status-chip ${r.status}`}>{STATUS_LABEL[r.status]}</span></td><td>{formatMs(r.sdkMs)}</td><td>{money(r.cost?.usd)}</td><td><button className="icon-button" aria-label={`Inspect run ${r.id}`} onClick={()=>{setInspected(r);setDialog('inspector');}}><ArrowUpRight size={16}/></button></td></tr>)}</tbody></table></div>}</Modal>}
    {dialog==='repeat'&&<Modal title="Repeat the experiment" onClose={()=>setDialog(null)} wide><p className="modal-intro">Run the current draft through both approaches repeatedly. Requests run one at a time, alternating which approach goes first.</p><div className="repeat-controls"><div><label htmlFor="repetitions">Paired repetitions</label><input id="repetitions" type="number" min={1} max={20} value={repetitions} disabled={busy} onChange={e=>setRepetitions(Number(e.target.value))}/></div><div className="repeat-cost-note"><strong>{Math.max(1,Math.min(20,repetitions||5))*2} live API requests</strong><span>Uses your key and incurs API charges</span></div>{busy?<button className="outline-button" onClick={()=>{cancel();setNotice('Repeat runs stopped. Completed results are kept.');}}><Square size={14}/>Stop</button>:<button className="primary-button" disabled={!listing?.title.trim()||listing.bullets.some(b=>!b.trim())} onClick={()=>void repeat()}><FlaskConical size={16}/>Start repeat runs</button>}</div>{progress.total>0&&<div className="repeat-progress" role="status"><span>{progress.done} / {progress.total} requests completed {busy&&'· Running…'}</span><progress max={progress.total} value={progress.done}/></div>}<div className="benchmark-results">{(['decisions','responses'] as Engine[]).map(engine=>{const group=batchRuns.filter(r=>r.engine===engine);const stats=summarize(group);return <div className="benchmark-card" key={engine}><span className="eyebrow">{engine==='decisions'?'DECISIONS':'RESPONSES'}</span><h3>{group[0]?.model??(engine==='decisions'?'gpt-6-luna':settings.model)}</h3><div className="benchmark-median">{formatMs(stats.median)}<span>median SDK round trip</span></div><dl><div><dt>Completed / errors</dt><dd>{stats.successes} / {stats.errors}</dd></div><div><dt>Range</dt><dd>{formatMs(stats.min)} – {formatMs(stats.max)}</dd></div><div><dt>p95 (20+ successes)</dt><dd>{formatMs(stats.p95)}</dd></div><div><dt>Known inference cost</dt><dd>{money(stats.cost)} ({stats.costCount}/{stats.count})</dd></div><div><dt>Expected-label agreement</dt><dd>{stats.agreement==null?'No labeled result':`${(stats.agreement*100).toFixed(0)}%`}</dd></div></dl></div>;})}</div><div className="info-box"><CircleHelp size={18}/><p>Small samples are exploratory. Timing includes the SDK’s network round trip. Cache behavior and token usage are retained in exports. Fixture agreement is not production accuracy. Costs exclude asset generation and infrastructure.</p></div><div className="modal-toolbar"><span>Current draft · {settings.model} · {settings.effort} reasoning</span><div><button className="outline-button" disabled={!runs.length} onClick={()=>exportRuns('csv')}><ArrowDownToLine size={14}/>Export CSV</button><button className="outline-button" disabled={!runs.length} onClick={()=>exportRuns('json')}><ArrowDownToLine size={14}/>Export JSON</button></div></div></Modal>}
    {dialog==='inspector'&&<Modal title="Under the hood" onClose={()=>setDialog(null)} wide>{inspected?<><div className="inspector-meta"><span className={`status-chip ${inspected.status}`}>{STATUS_LABEL[inspected.status]}</span><span>{inspected.engine} · {inspected.model}{inspected.engine==='responses'&&` · ${inspected.settings.effort} reasoning`}</span></div><div className="inspector-stats"><div><span>SDK round trip</span><strong>{formatMs(inspected.sdkMs)}</strong></div><div><span>Browser round trip</span><strong>{formatMs(inspected.roundTripMs)}</strong></div><div><span>Est. inference cost</span><strong>{money(inspected.cost?.usd)}</strong></div></div>{inspected.error&&<div className="banner error">{inspected.error}</div>}<div className="inspector-checks">{inspected.checks.map(c=><div key={c.id}><StatusIcon outcome={c.outcome}/><span>{CHECK_LABELS[c.id]}</span><code>{c.outcome}</code></div>)}</div><p className="fine-print">Decisions probabilities are model estimates, not measured accuracy. Responses is not asked to invent comparable confidence scores. Raw probabilities remain visible below.</p>{[['Usage & cost',{usage:inspected.usage,cost:inspected.cost}],['Request (image bytes omitted)',inspected.request],['Raw response',inspected.raw],['Run metadata',{id:inspected.id,timestamp:inspected.timestamp,fingerprint:inspected.fingerprint,fixtureId:inspected.fixtureId,settings:inspected.settings,questionVersion:inspected.questionVersion,expected:inspected.expected,agreement:inspected.agreement}]].map(([title,value])=><details className="code-details" key={String(title)}><summary><Code2 size={14}/>{String(title)}<ChevronDown size={14}/></summary><pre>{JSON.stringify(value,null,2)}</pre></details>)}</>:<p>No run selected.</p>}</Modal>}
  </>;
}
