import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  ClipboardCheck,
  Layers3,
  ArrowUpRight,
  Activity,
  Inbox,
} from 'lucide-react';
import {
  actionLabels,
  type Workspace,
  type Draft,
  type Finding,
  type Validation,
  type ReviewCase,
  type Action,
} from '../shared/workflow.ts';
import { Sources } from './Sources.tsx';
import { Policy } from './Policy.tsx';
import { Release } from './Release.tsx';
import { Pilot } from './Pilot.tsx';
import './onsite.css';

async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
  signal?: AbortSignal,
): Promise<T> {
  const view=sessionStorage.getItem('onsite-view') || 'seller';
  let response = await fetch('/api/' + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'X-Onsite-View': view,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if(response.status===401&&path==='workspace'){
    // The local role chooser can renew its synthetic session after a server restart.
    await api('session',{role:view});
    response=await fetch('/api/workspace',{headers:{'X-Onsite-View':view},signal});
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Request unavailable');
  return data;
}
const routes = { green: 'Cleared', red: 'Correction needed', yellow: 'Evidence needed' };
const draftLabels: Record<string, string> = {
  headphones: 'Matte-black headphones',
  plush: 'Promotional main photo',
  sibling: 'Graphite headphone variant',
  coffee: 'Published coffee maker',
  refund: 'Refund guarantee bullet',
};
function Badge({ value }: { value: string }) {
  return (
    <span className={'on-badge ' + value}>{routes[value as keyof typeof routes] ?? value}</span>
  );
}
function Rule({ f }: { f: Finding }) {
  return (
    <details className="on-rule">
      <summary>
        <span>{f.criterion.title}</span>
        <Badge value={f.route} />
      </summary>
      <div>
        <h4>Which rule applies?</h4>
        <p>{f.criterion.rule}</p>
        <small>
          {f.criterion.authority} · US · {f.criterion.field} · {f.criterion.placement} placement
        </small>
        {f.criterion.source && (
          <p>
            <a href={f.criterion.source} target="_blank" rel="noreferrer">
              {f.criterion.id === 'white_background'
                ? 'Public Amazon photography guidance'
                : 'Public Amazon source'}{' '}
              ↗
            </a>{' '}
            ·{' '}
            <a href={f.criterion.canonical} target="_blank" rel="noreferrer">
              Seller Central ↗
            </a>
          </p>
        )}
        {f.knowledgeTrace && (
          <section aria-label="Commerce ontology">
            <h4>Commerce ontology</h4>
            <small>{f.knowledgeTrace.domain.categoryPath.join(' / ')} · {f.knowledgeTrace.domain.version}</small>
            <p><strong>{f.knowledgeTrace.subject}</strong></p>
            <p>{f.knowledgeTrace.domain.definition} {f.knowledgeTrace.domain.requirement}</p>
            <p>
              {f.knowledgeTrace.domain.field && <strong>{f.knowledgeTrace.domain.field} · </strong>}
              {f.knowledgeTrace.observation}<br /><code>{f.knowledgeTrace.sourceRef}</code>
            </p>
          </section>
        )}
        <h4>What evidence was checked?</h4>
        {f.evidence.map((e) => (
          <details key={e.ref}>
            <summary>{e.label}</summary>
            <code>{e.ref}</code>
            <p className="pre">{e.text}</p>
            {e.image && (
              <img className="on-source-photo" src={e.image} alt="Evaluated product photograph" />
            )}
          </details>
        ))}
        <h4>Why this action?</h4>
        <p>{f.reason}</p>
        {f.question && (
          <p>
            <code>{f.criterion.id}</code> · {f.question}
          </p>
        )}
        {f.probabilities && (
          <div className="on-probs">
            {Object.entries(f.probabilities).map(([key, p]) => (
              <span key={key}>
                {key.replace('_', ' ')} <b>{Number((p * 100).toFixed(2))}%</b>
              </span>
            ))}
          </div>
        )}
        <h4>Who can change the outcome?</h4>
        <p>
          {f.criterion.remedy} {f.criterion.owner} owns this mapping.
        </p>
        <small>
          {f.policy} · {f.criterion.verification}
        </small>
      </div>
    </details>
  );
}
const fieldLabels = { title: 'title', bullets: 'bullet text', image: 'photo' } as const;
function FieldFeedback({ field, findings, draft }: {
  field: keyof typeof fieldLabels;
  findings: Finding[];
  draft: Draft;
}) {
  const issues = findings.filter(f => f.criterion.field === field);
  const primary = issues[0];
  if (!primary) return null;
  const trace = issues.find(f => f.knowledgeTrace)?.knowledgeTrace;
  let action = primary.criterion.remedy;
  let detail = primary.criterion.title;
  if (primary.criterion.id === 'image_product' && primary.route === 'red' &&
      draft.sku === 'FORM-H01-BLK' && draft.facts.Color === 'Matte black' &&
      draft.imageId === 'headphones-cream' && draft.choices.includes('headphones-black')) {
    action = 'Choose the midnight-black photo';
    detail = 'The selected photo shows cream headphones. This SKU is matte black.';
  } else if (primary.criterion.id === 'asset_approval') {
    action = 'Verify this photo for the selected variant';
    detail = draft.sku + ' · ' + primary.reason;
  } else if (primary.route === 'yellow') {
    action = 'Provide evidence for ' + primary.criterion.title.toLowerCase();
    detail = primary.reason;
  }
  return (
    <section className="on-field-feedback" aria-label={fieldLabels[field] + ' feedback'}>
      <div className="on-field-action">
        <strong>{action}</strong>
        <p>{detail}</p>
      </div>
      <details className="on-feedback-details">
        <summary>Why this {fieldLabels[field]} was flagged</summary>
        <dl>
          {issues.some(f => f.question) && <div>
            <dt>Decisions API</dt>
            <dd>{issues.filter(f => f.question).map(f => {
              const p = f.probabilities;
              const reading = p && p.mismatch >= f.criterion.red ? 'Mismatch' :
                p && p.match >= f.criterion.green ? 'Match' : 'Inconclusive';
              return <div key={f.criterion.id}>{f.criterion.title} · {reading}</div>;
            })}</dd>
          </div>}
          {trace && <>
            <div><dt>Commerce ontology</dt><dd>{trace.domain.requirement}</dd></div>
            <div>
              <dt>{trace.domain.source === 'asset' ? 'Asset library' : 'Manufacturer record'}</dt>
              <dd>{trace.observation}</dd>
            </div>
          </>}
          {issues.filter(f => !f.question && !f.knowledgeTrace).map(f => (
            <div key={f.criterion.id}><dt>{f.criterion.title}</dt><dd>{f.reason}</dd></div>
          ))}
        </dl>
        {issues.map(f => <Rule key={f.criterion.id} f={f} />)}
      </details>
    </section>
  );
}
function SellerRequest({ c, apply }: { c: ReviewCase; apply: (text: string) => void }) {
  const event = [...c.events].reverse().find((e) => e.label === 'Correction requested');
  if (!event || c.status !== 'Correction requested') return null;
  const receipt = JSON.parse(event.detail);
  return (
    <div className="on-confirm">
      <p>{receipt.rationale}</p>
      {receipt.suggestedText && (
        <>
          <blockquote>{receipt.suggestedText}</blockquote>
          {c.source === 'Shopper report' && (
            <button onClick={() => apply(receipt.suggestedText)}>Use proposed bullet</button>
          )}
        </>
      )}
    </div>
  );
}
function Timeline({ c }: { c: ReviewCase }) {
  return (
    <div className="on-timeline">
      {c.events.map((e, i) => (
        <div key={i}>
          <strong>{e.label}</strong>
          <small>
            {e.actor} · revision {e.revision} · {new Date(e.at).toLocaleTimeString()}
          </small>
          {e.detail.startsWith('{') ? (
            <details>
              <summary>Decision receipt</summary>
              <pre>{JSON.stringify(JSON.parse(e.detail), null, 2)}</pre>
            </details>
          ) : (
            <p>{e.detail}</p>
          )}
        </div>
      ))}
    </div>
  );
}
function Seller({
  space,
  update,
  lock,
}: {
  space: Workspace;
  update: () => Promise<void>;
  lock: (v: boolean) => void;
}) {
  const [id, select] = useState(sessionStorage.getItem('selected-draft') || 'headphones'),
    [busy, setBusy] = useState(false);
  const hold = useCallback(
    (v: boolean) => {
      setBusy(v);
      lock(v);
    },
    [lock],
  );
  const draft = space.drafts.find((d) => d.id === id) ?? space.drafts[0];
  if (!draft) return null;
  return (
    <>
      <div className="on-title">
        <div>
          <p className="on-kicker">SELLER WORKSPACE</p>
          <h1>Listing studio</h1>
        </div>
        <span className="on-identity">Cedar Market</span>
      </div>
      <div className="on-layout">
        <aside className="on-panel">
          <h3>Product drafts</h3>
          {space.drafts.map((d) => (
            <button
              className={'on-product ' + (d.id === id ? 'sel' : '')}
              key={d.id}
              disabled={busy}
              onClick={() => {
                sessionStorage.setItem('selected-draft', d.id);
                select(d.id);
              }}
            >
              <img src={'/products/' + space.assets.find((a) => a.id === d.imageId)?.file} alt="" />
              <span>
                <b>{draftLabels[d.id]}</b>
                <small>{d.sku}</small>
              </span>
            </button>
          ))}
        </aside>
        <Editor key={draft.id} initial={draft} space={space} update={update} hold={hold} />
      </div>
    </>
  );
}
function Editor({
  initial,
  space,
  update,
  hold,
}: {
  initial: Draft;
  space: Workspace;
  update: () => Promise<void>;
  hold: (v: boolean) => void;
}) {
  const [draft, setDraft] = useState(initial),
    [run, setRun] = useState<Validation>(),
    [message, setMessage] = useState('Checking draft…'),
    [retry, setRetry] = useState(0),
    [question, ask] = useState(''),
    [showHelp, help] = useState(false);
  const saved = useRef(initial),
    writes = useRef(Promise.resolve());
  const cases = space.cases.filter((c) => c.draftId === draft.id);
  useEffect(() => {
    let current = true;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        if (!draft.title.trim() || draft.bullets.some((b) => !b.trim())) {
          if (current) setMessage('Complete the title and each bullet to validate.');
          return;
        }
        const task = writes.current
          .catch(() => {})
          .then(async () => {
            if (!current) return;
            const payload = {
              title: draft.title,
              bullets: draft.bullets,
              imageId: draft.imageId,
              placement: draft.placement,
            };
            const prior = saved.current;
            if (
              Object.keys(payload).some(
                (k) =>
                  JSON.stringify(prior[k as keyof Draft]) !==
                  JSON.stringify(payload[k as keyof typeof payload]),
              )
            ) {
              saved.current = await api<Draft>(
                'drafts/' + draft.id,
                { ...payload, expectedRevision: prior.revision },
                'PATCH',
              );
            }
          });
        writes.current = task;
        await task;
        if (!current) return;
        const rev = saved.current.revision;
        const latest = await api<{ draft: Draft; run?: Validation }>(
          'drafts/' + draft.id,
          undefined,
          undefined,
          ctrl.signal,
        );
        if (latest.draft.revision !== rev) throw Error('A newer draft exists. Reload to continue.');
        const result = await api<Validation>(
          'drafts/' + draft.id + '/checks',
          { revision: rev },
          undefined,
          ctrl.signal,
        );
        if (current) {
          setRun(result);
          setMessage('');
          await update();
        }
      } catch (e) {
        if (current) setMessage((e as Error).message);
      } finally {
        if (current) hold(false);
      }
    }, 600);
    return () => {
      current = false;
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [draft, retry, update, hold]);
  function edit(patch: Partial<Draft>) {
    hold(true);
    setRun(undefined);
    setMessage('Saving and checking…');
    setDraft((prev) => ({ ...prev, ...patch }));
  }
  const selected = space.assets.find((a) => a.id === draft.imageId)!;
  const unresolved = (run?.findings ?? []).filter(f => f.route !== 'green').sort((a, b) =>
    Number(b.route === 'red') - Number(a.route === 'red') ||
    (a.route === 'yellow' ? Number(Boolean(b.knowledgeTrace)) - Number(Boolean(a.knowledgeTrace)) : 0));
  const first = unresolved[0];
  const cleared = run?.findings.filter(f => f.route === 'green') ?? [];
  return (
    <div className="on-content">
      <section className="on-panel">
        <div className="on-section">
          <div>
            <small>
              {draft.category} / {draft.sku}
            </small>
            <h2>{draft.name}</h2>
          </div>
          {run && <Badge value={run.route} />}
        </div>
        <div className="on-fields">
          <div>
            <label>
              Product title
              <input value={draft.title} onChange={(e) => edit({ title: e.target.value })} />
            </label>
            <FieldFeedback field="title" findings={unresolved} draft={draft} />
            <h4>Bullet points</h4>
            {draft.bullets.map((b, i) => (
              <label key={i}>
                <span className="sr-only">Bullet {i + 1}</span>
                <textarea
                  aria-label={'Bullet ' + (i + 1)}
                  value={b}
                  onChange={(e) =>
                    edit({ bullets: draft.bullets.map((s, j) => (j === i ? e.target.value : s)) })
                  }
                />
              </label>
            ))}
            <FieldFeedback field="bullets" findings={unresolved} draft={draft} />
            {run?.findings.some((f) => f.criterion.id === 'bullet_refund' && f.route === 'red') && (
              <button
                onClick={() =>
                  edit({
                    bullets: draft.bullets.map((b) =>
                      /full refund/i.test(b) ? 'Filter-basket drip brewing for everyday coffee' : b,
                    ),
                  })
                }
              >
                Replace promotional bullet
              </button>
            )}
          </div>
          <div className="on-photo">
            <label>
              Image placement
              <select
                value={draft.placement}
                onChange={(e) => edit({ placement: e.target.value as Draft['placement'] })}
              >
                <option value="main">Main image</option>
                <option value="secondary">Secondary image</option>
              </select>
            </label>
            <img src={'/products/' + selected.file} alt={selected.label} />
            <div className="on-thumbs">
              {draft.choices.map((id) => {
                const a = space.assets.find((a) => a.id === id)!;
                return (
                  <button
                    key={id}
                    aria-label={'Use ' + a.label}
                    aria-pressed={id === draft.imageId}
                    onClick={() => edit({ imageId: id })}
                  >
                    <img src={'/products/' + a.file} alt="" />
                    {a.label}
                  </button>
                );
              })}
            </div>
            <FieldFeedback field="image" findings={unresolved} draft={draft} />
          </div>
        </div>
        {message && (
          <p role="status">
            {message} <button onClick={() => setRetry((t) => t + 1)}>Retry check</button>
          </p>
        )}
        {run && (
          <>
            {cleared.length > 0 && <details className="on-cleared-checks">
              <summary>{cleared.length} cleared {cleared.length === 1 ? 'check' : 'checks'} <small>Revision {run.revision}</small></summary>
              {cleared.map(f => <Rule key={f.criterion.id} f={f} />)}
            </details>}
            {first && (
              <button className="on-primary" onClick={() => help(!showHelp)}>
                Request specialist help
              </button>
            )}
            {first && showHelp && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api('drafts/' + draft.id + '/help', {
                      revision: run.revision,
                      check: first.criterion.id,
                      question,
                    });
                    help(false);
                    await update();
                  } catch (e) {
                    setMessage((e as Error).message);
                  }
                }}
              >
                <label>
                  Question for the reviewer
                  <textarea required value={question} onChange={(e) => ask(e.target.value)} />
                </label>
                <button className="on-primary">Send request</button>
              </form>
            )}
          </>
        )}
      </section>
      {cases.map((c) => (
        <section className="on-panel" key={c.id}>
          <small>Seller inbox</small>
          <h2>{c.status}</h2>
          <SellerRequest
            c={c}
            apply={(text) => edit({ bullets: [text, ...draft.bullets.slice(1)] })}
          />
          <Timeline c={c} />
          <Rule f={c.finding} />
        </section>
      ))}
    </div>
  );
}

function Reviewer({ space, update }: { space: Workspace; update: () => Promise<void> }) {
  const [id, select] = useState(sessionStorage.getItem('selected-case') || ''),
    [twin, setTwin] = useState(sessionStorage.getItem('silent-twin') === 'true');
  const list = space.cases.filter((c) => c.twin === twin),
    c = list.find((c) => c.id === id) ?? list[0];
  return (
    <>
      <div className="on-title">
        <div>
          <p className="on-kicker">CATALOG QUALITY</p>
          <h1>Maya’s review queue</h1>
          <p>Consumer electronics and small appliances</p>
        </div>
        <span className="on-identity">Maya · Reviewer</span>
      </div>
      <div className="on-layout">
        <aside className="on-panel">
          <h3>
            Assigned to me <small>{list.length}</small>
          </h3>
          {list.map((item) => (
            <button
              className={'on-case ' + (c?.id === item.id ? 'sel' : '')}
              key={item.id}
              onClick={() => {
                sessionStorage.setItem('selected-case', item.id);
                select(item.id);
              }}
            >
              <small>{item.source}</small>
              <b>{item.sku}</b>
              <span>
                {item.status} · {item.prep}
              </span>
              <small>
                Opened {Math.max(0, Math.floor((Date.now() - Date.parse(item.created)) / 60000))}{' '}
                min ago
              </small>
            </button>
          ))}
          <button
            className="on-link"
            onClick={() => {
              sessionStorage.setItem('silent-twin', String(!twin));
              sessionStorage.removeItem('selected-case');
              setTwin(!twin);
              select('');
            }}
          >
            {twin ? 'Return to assigned queue' : 'Same report, manufacturer silent'} →
          </button>
        </aside>
        {c ? (
          <CaseView key={c.id} c={c} space={space} update={update} />
        ) : (
          <p>No assigned cases.</p>
        )}
      </div>
    </>
  );
}
function CaseView({
  c,
  space,
  update,
}: {
  c: ReviewCase;
  space: Workspace;
  update: () => Promise<void>;
}) {
  const [message, setMessage] = useState(''),
    [confirm, setConfirm] = useState<Action>(),
    [pending, setBusy] = useState(false),
    [manual, setManual] = useState(''),
    [rationale, explain] = useState('');
  const keys = useRef(new Map<string, string>());
  useEffect(() => {
    let lastInput = Date.now();
    const touch = () => {
      lastInput = Date.now();
    };
    const activity = (mode: string) =>
      void api('cases/' + c.id + '/activity', { mode }).catch(() => {});
    if (c.status !== 'In review') return;
    const visibility = () => activity(document.hidden ? 'pause' : 'start');
    visibility();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    const ping = setInterval(
      () => activity(document.hidden || Date.now() - lastInput > 45000 ? 'pause' : 'heartbeat'),
      15000,
    );
    return () => {
      clearInterval(ping);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      activity('pause');
    };
  }, [c.id, c.status]);
  const b = c.brief;
  function handoff() {
    if (space.handoff === 'brief' && c.preparedChatUrl) {
      window.open(c.preparedChatUrl, '_blank', 'noopener,noreferrer');
      setMessage(
        'Opened the prepared conversation for revision ' +
          c.revision +
          '. Record the disposition here.',
      );
      return;
    }
    const prompt =
      space.handoff === 'brief'
        ? 'Review this synthetic catalog case as Maya. Cite independent exact-SKU evidence and explain what justifies the proposed action. The local case system records approval.\n' +
          JSON.stringify(
            {
              case_id: c.id,
              revision: c.revision,
              report: c.report,
              brief: b,
              knowledge_trace: c.finding.knowledgeTrace,
              evidence: c.evidence.map(({ ref, text, label }) => ({ ref, text, label })),
            },
            null,
            2,
          )
        : 'Open case ' + c.id + ' with the reviewer app.';
    window.open(space.chatUrl, '_blank', 'noopener,noreferrer');
    if (!navigator.clipboard) {
      setManual(prompt);
      return;
    }
    void navigator.clipboard
      .writeText(prompt)
      .then(() =>
        setMessage(
          space.chatUrl.includes('/plugins/')
            ? 'Choose Try in chat, paste the case ID and press Return.'
            : 'Copied. Paste into ChatGPT and press Return.',
        ),
      )
      .catch(() => setManual(prompt));
  }
  async function act(action: Action) {
    if (!b) return;
    setBusy(true);
    try {
      const op = JSON.stringify([c.version, action, rationale.trim()]);
      if (!keys.current.has(op)) keys.current.set(op, crypto.randomUUID());
      await api('cases/' + c.id + '/action', {
        action,
        expected_case_version: c.version,
        expected_listing_revision: c.revision,
        brief_id: b.id,
        idempotency_key: keys.current.get(op),
        rationale: rationale.trim() || undefined,
      });
      setConfirm(undefined);
      setMessage('Decision recorded in the seller timeline.');
      await update();
    } catch (e) {
      setMessage((e as Error).message);
      await update();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="on-content">
      <section className="on-panel">
        <div className="on-section">
          <div>
            <small>
              {c.source} / {c.sku} / revision {c.revision}
            </small>
            <h2>{c.twin ? 'Manufacturer record is silent' : c.finding.criterion.title}</h2>
          </div>
          <Badge value={c.status} />
        </div>
        {c.source === 'Shopper report' && (
          <>
            <h4>Published bullet under review</h4>
            <blockquote>
              {(
                c.evidence.find((e) => e.label === 'Original published listing') ??
                c.evidence.find((e) => e.ref.startsWith('listing/'))
              )?.text
                .split('\n')
                .slice(1)
                .find((t) => /espresso/i.test(t)) ?? 'See the linked listing revision.'}
            </blockquote>
          </>
        )}
        <h4>Original {c.source === 'Shopper report' ? 'shopper allegation' : 'request'}</h4>
        <blockquote>{c.report}</blockquote>
        <h4>Independent evidence</h4>
        {c.evidence.map((e) => (
          <details className="on-evidence" key={e.ref}>
            <summary>{e.label}</summary>
            <code>{e.ref}</code>
            <p className="pre">{e.text}</p>
            {e.image && <img className="on-source-photo" src={e.image} alt="Case evidence" />}
          </details>
        ))}
        <Rule f={c.finding} />
        {c.attempts.length > 0 && (
          <details>
            <summary>Merchant submission history ({c.attempts.length})</summary>
            {c.attempts.map((a, i) => (
              <p key={i}>
                Attempt {i + 1} · {a.merchant} / {a.agent} · {a.locale}
                <br />
                {a.bullets.join(' · ')}
              </p>
            ))}
          </details>
        )}
      </section>
      <section className="on-panel prepared">
        <div className="on-section">
          <div>
            <small>
              {c.prep} {b ? '· ' + b.model : ''}
            </small>
            <h2>Prepared reviewer brief</h2>
          </div>
          <ClipboardCheck />
        </div>
        {b && c.prep === 'Ready' && (
          <>
            <h3>{actionLabels[b.recommendation]}</h3>
            <p>{b.rationale}</p>
            {b.suggestedText && <blockquote>{b.suggestedText}</blockquote>}
            {b.uncertainties.map((s) => (
              <p key={s}>{s}</p>
            ))}
            <small>{b.citations.join(' · ')}</small>
            <div>
              <button className="on-primary" onClick={handoff}>
                Review in ChatGPT <ArrowUpRight size={15} />
              </button>
              <small>
                {space.handoff === 'brief'
                  ? 'Prepared synthetic brief · manual handoff'
                  : space.handoff === 'mcp-read'
                    ? 'Authenticated MCP read · approve here'
                    : 'Connected reviewer tools'}
              </small>
            </div>
          </>
        )}
        {manual && (
          <label>
            Copy into ChatGPT
            <textarea readOnly value={manual} onFocus={(e) => e.target.select()} />
          </label>
        )}
        {c.status === 'In review' && ['Preparation failed', 'Stale brief'].includes(c.prep) && (
          <button
            onClick={async () => {
              try {
                await api('cases/' + c.id + '/prepare', {});
                await update();
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            Prepare current brief
          </button>
        )}
        {c.actions.length > 0 && (
          <div className="on-actions">
            {(Object.keys(actionLabels) as Action[]).map((a) => (
              <button
                key={a}
                disabled={!c.actions.includes(a) || pending}
                onClick={() => {
                  explain('');
                  setConfirm(a);
                }}
              >
                {actionLabels[a]}
              </button>
            ))}
          </div>
        )}
        {confirm && c.actions.includes(confirm) && (
          <div className="on-confirm">
            Record “{actionLabels[confirm]}” as Maya for revision {c.revision}?{' '}
            {confirm !== b?.recommendation && (
              <label>
                Reason for this disposition
                <textarea value={rationale} onChange={(e) => explain(e.target.value)} />
              </label>
            )}
            <button
              disabled={pending || (confirm !== b?.recommendation && !rationale.trim())}
              onClick={() => void act(confirm)}
            >
              Confirm decision
            </button>
            <button onClick={() => setConfirm(undefined)}>Cancel</button>
          </div>
        )}
        {message && <p role="status">{message}</p>}
      </section>
      <section className="on-panel">
        <h2>Case history</h2>
        <Timeline c={c} />
      </section>
    </div>
  );
}
export default function Onsite() {
  const [role, choose] = useState(sessionStorage.getItem('onsite-view') || 'seller'),
    [space, setSpace] = useState<Workspace>(),
    [error, setError] = useState(''),
    [locked, lock] = useState(false);
  const seq = useRef(0);
  const update = useCallback(async () => {
    const n = ++seq.current;
    const s = await api<Workspace>('workspace');
    if (n === seq.current) {
      setSpace(s);
      setError('');
    }
  }, []);
  useEffect(() => {
    let current = true;
    setSpace(undefined);
    setError('');
    sessionStorage.setItem('onsite-view', role);
    api('session', { role })
      .then(() => {
        if (current) return update();
      })
      .catch((e) => current && setError(e.message));
    const poll =
      role === 'maya' || role === 'seller'
        ? setInterval(() => void update().catch((e) => setError(e.message)), 3500)
        : null;
    return () => {
      current = false;
      seq.current++;
      if (poll) clearInterval(poll);
    };
  }, [role, update]);
  return (
    <div className="onsite">
      <header className="on-header">
        <div>
          <Layers3 />
          <strong>Seller Listing Validator</strong>
        </div>
        <span>Amazon selling partner concept</span>
      </header>
      <nav className="on-nav">
        {(
          [
            ['seller', 'Seller studio', Box],
            ['maya', 'Reviewer queue', Inbox],
            ['operations', 'Pilot impact', Activity],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            aria-current={role === key ? 'page' : undefined}
            disabled={locked}
            onClick={() => choose(key)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
        <select
          className="on-role-select"
          aria-label="Technical workspaces"
          disabled={locked}
          value={['policy', 'steward', 'auditor', 'engineer'].includes(role) ? role : ''}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="" disabled>
            Technical workspaces
          </option>
          <option value="engineer">Release evidence</option>
          <option value="policy">Policy review</option>
          <option value="steward">Verified sources</option>
          <option value="auditor">Case audit</option>
        </select>
        <a href="/lab">Comparison lab ↗</a>
      </nav>
      <main>
        {error ? (
          <p role="alert">
            {error} <button onClick={() => location.reload()}>Reload</button>
          </p>
        ) : space?.role !== role ? (
          <p>Opening workspace…</p>
        ) : role === 'seller' ? (
          <Seller space={space} update={update} lock={lock} />
        ) : role === 'maya' ? (
          <Reviewer space={space} update={update} />
        ) : role === 'auditor' ? (
          <>
            <h1>Case audit</h1>
            {space.cases.map((c) => (
              <section key={c.id} className="on-panel">
                <h2>
                  {c.sku} · {c.status}
                </h2>
                <code>{c.id}</code>
                <Timeline c={c} />
              </section>
            ))}
          </>
        ) : role === 'steward' ? (
          <Sources />
        ) : role === 'policy' ? (
          <Policy />
        ) : role === 'engineer' ? (
          <Release />
        ) : (
          <Pilot />
        )}
      </main>
      <footer>Interview demonstration · Synthetic catalog and cases · US marketplace</footer>
    </div>
  );
}
