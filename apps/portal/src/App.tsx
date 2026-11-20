import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { Customer, Operation, Quote, Reconciliation, Wallet } from '../../../packages/banking/contracts';
import { ApiError, request } from './api';
import { amountError, decimal, money } from './money';
import Icon from './Icon';
import { Activity, statusText } from './Activity';

type View = 'overview' | 'funding' | 'exchange' | 'payouts' | 'activity' | 'reconciliation';
type Dashboard = { customer: Customer; wallets: Wallet[]; operations: Operation[] };
type Intent = { customerId: string; kind: 'funding' | 'exchange' | 'payout' | 'settlement'; path: string; body: Record<string, string>; key: string; createdAt: string };
const pages: { id: View; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { id: 'overview', label: 'Overview', icon: 'grid' }, { id: 'exchange', label: 'Exchange', icon: 'exchange' },
  { id: 'payouts', label: 'Payouts', icon: 'arrow' }, { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'reconciliation', label: 'Reconcile', icon: 'shield' },
];
const storageKey = (id: string) => `evolve.sandbox.intent:${id}`;
function readIntent(customerId: string): Intent | undefined {
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey(customerId)) ?? 'null') as Intent | null;
    if (stored && stored.customerId === customerId && typeof stored.key === 'string' && typeof stored.path === 'string' && stored.path.startsWith('/') && stored.body) return stored;
  } catch { /* A new page can still load when browser storage is unavailable. */ }
  return undefined;
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

export default function App() {
  const [data, setData] = useState<Dashboard>();
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>(() => pages.some(page => page.id === location.hash.slice(1)) ? location.hash.slice(1) as View : 'overview');
  const [busy, setBusy] = useState('');
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [intent, setIntent] = useState<Intent>();
  const [fundingAmount, setFundingAmount] = useState('100.00');
  const [exchangeAmount, setExchangeAmount] = useState('100.00');
  const [payoutAmount, setPayoutAmount] = useState('99000.00');
  const [beneficiary, setBeneficiary] = useState('Sandbox recipient');
  const [quote, setQuote] = useState<Quote>();
  const [now, setNow] = useState(Date.now());
  const [report, setReport] = useState<Reconciliation>();
  const [lastSync, setLastSync] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);

  const refresh = useCallback(async () => {
    const dashboard = await request<Dashboard>('/dashboard');
    dashboard.operations = [...dashboard.operations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    setData(dashboard);
    setLastSync(new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }));
    const pending = readIntent(dashboard.customer.id);
    const resolved = pending && dashboard.operations.some(op => pending.kind === 'settlement'
      ? pending.path === `/sandbox/payouts/${encodeURIComponent(op.id)}/settle` && ['completed', 'failed'].includes(op.status) && op.outcome === pending.body.outcome
      : op.idempotencyKey === pending.key && ['completed', 'pending', 'failed'].includes(op.status));
    if (resolved) {
      sessionStorage.removeItem(storageKey(dashboard.customer.id)); setIntent(undefined); setError('');
      setNotice('Your original request is confirmed. The latest balances and activity are shown below.');
    } else if (pending) {
      setIntent(pending);
    } else {
      // Recover a durable server intention even after this browser's storage was cleared.
      const unresolved = dashboard.operations.find(op => ['processing', 'review'].includes(op.status));
      if (unresolved) {
        const recovery: Intent = {
          customerId: dashboard.customer.id, kind: unresolved.kind, key: unresolved.idempotencyKey, createdAt: unresolved.createdAt,
          path: unresolved.kind === 'funding' ? '/sandbox/funding' : unresolved.kind === 'exchange' ? '/exchanges' : '/payouts',
          body: unresolved.kind === 'exchange' ? { quoteId: unresolved.quoteId ?? '' } : unresolved.kind === 'payout' ? { amount: decimal(unresolved.amountMinor), beneficiary: unresolved.beneficiary ?? 'Sandbox recipient' } : { amount: decimal(unresolved.amountMinor) },
        };
        if (unresolved.outcome && unresolved.kind === 'payout') {
          recovery.kind = 'settlement'; recovery.path = `/sandbox/payouts/${encodeURIComponent(unresolved.id)}/settle`;
          recovery.body = { outcome: unresolved.outcome };
        }
        sessionStorage.setItem(storageKey(dashboard.customer.id), JSON.stringify(recovery)); setIntent(recovery);
      } else setIntent(undefined);
    }
    return dashboard;
  }, []);

  useEffect(() => {
    refresh().catch(err => { if (!(err instanceof ApiError && err.status === 401)) setError(errorMessage(err)); }).finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const changed = () => { const next = location.hash.slice(1); if ([...pages.map(p => p.id), 'funding'].includes(next as View)) setView(next as View); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => { document.title = `${view === 'funding' ? 'Add demo USD' : pages.find(page => page.id === view)?.label ?? 'Overview'} · Evolve Bank Sandbox`; }, [view]);

  function go(next: View) { setView(next); location.hash = next; setError(''); window.setTimeout(() => heading.current?.focus(), 0); }
  function clearIntent(customerId: string) { sessionStorage.removeItem(storageKey(customerId)); setIntent(undefined); }

  async function execute(next: Intent) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(next.kind); setError(''); setNotice('');
    let result: Operation | undefined;
    try {
      // Store before sending. An interrupted response must retain the same payload and key.
      sessionStorage.setItem(storageKey(next.customerId), JSON.stringify(next)); setIntent(next);
      result = await request<Operation>(next.path, { method: 'POST', body: next.body, key: next.key });
      if (['completed', 'pending', 'failed'].includes(result.status)) {
        clearIntent(next.customerId);
        if (next.kind === 'exchange') setQuote(undefined);
        setNotice(result.status === 'failed' ? 'The simulated payout failed. Its reserved funds have been returned.' : result.status === 'pending' ? 'Payout requested. Funds are reserved until you simulate a result below.' : next.kind === 'settlement' ? 'The simulated payout is complete.' : next.kind === 'funding' ? 'Demo USD added. You can now create an exchange quote.' : 'Conversion complete. Your demo NGN is ready for a payout.');
        if (next.kind === 'payout' || next.kind === 'settlement') setView('payouts');
      } else {
        setError('This transaction needs confirmation. Use Retry original request to safely check the same transaction.');
      }
      setReport(undefined);
    } catch (err) {
      // Validation errors are definitive; transport/server errors may hide a completed posting.
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429 && err.code !== 'IDEMPOTENCY_CONFLICT') clearIntent(next.customerId);
      setError(errorMessage(err));
    } finally {
      await refresh().catch(() => { if (result) setError('Your request was recorded, but balances could not refresh. Use Refresh to load the latest activity.'); });
      inFlight.current = false; setBusy('');
    }
  }

  function mutate(kind: Intent['kind'], path: string, body: Record<string, string>) {
    if (!data || busy) return;
    if (intent) { setError('Resolve the original request before starting another transaction. Its details and retry button are above.'); return; }
    void execute({ customerId: data.customer.id, kind, path, body, key: crypto.randomUUID(), createdAt: new Date().toISOString() });
  }

  async function start() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy('start'); setError('');
    try { await request('/sandbox/sessions', { method: 'POST', body: {} }); await refresh(); }
    catch (err) { setError(errorMessage(err)); }
    finally { inFlight.current = false; setBusy(''); }
  }
  async function logout() {
    if (inFlight.current || intent) return;
    inFlight.current = true; setBusy('logout');
    try { await request('/session', { method: 'DELETE' }); setData(undefined); setQuote(undefined); setReport(undefined); setNotice(''); setView('overview'); }
    catch (err) { setError(errorMessage(err)); }
    finally { inFlight.current = false; setBusy(''); }
  }
  async function getQuote() {
    const invalid = amountError(exchangeAmount, 101n);
    if (invalid) { setError(invalid); return; }
    if (inFlight.current || intent) return;
    inFlight.current = true; setBusy('quote'); setError(''); setNotice('');
    try { const nextQuote = await request<Quote>('/quotes', { method: 'POST', body: { amount: exchangeAmount } }); setNow(Date.now()); setQuote(nextQuote); }
    catch (err) { setQuote(undefined); setError(errorMessage(err)); }
    finally { inFlight.current = false; setBusy(''); }
  }
  async function reconcile() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy('reconcile'); setError('');
    try { setReport(await request<Reconciliation>('/reconciliation')); await refresh(); }
    catch (err) { setError(errorMessage(err)); }
    finally { inFlight.current = false; setBusy(''); }
  }
  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy('refresh'); setError('');
    try { await refresh(); } catch (err) { setError(errorMessage(err)); }
    finally { inFlight.current = false; setBusy(''); }
  }

  const locked = Boolean(busy || intent);
  const usd = data?.wallets.find(wallet => wallet.currency === 'USD');
  const ngn = data?.wallets.find(wallet => wallet.currency === 'NGN');
  const pendingPayouts = data?.operations.filter(op => op.kind === 'payout' && op.status === 'pending') ?? [];
  const quoteSeconds = quote ? Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - now) / 1000)) : 0;
  const steps = [data?.operations.some(op => op.kind === 'funding' && op.status === 'completed'), data?.operations.some(op => op.kind === 'exchange' && op.status === 'completed'), data?.operations.some(op => op.kind === 'payout' && op.status === 'completed')];

  if (loading) return <main className="boot"><Brand/><span className="spinner"/><p>Opening your sandbox…</p></main>;
  if (!data) return <main className="welcome"><div className="welcome-top"><Brand/><span className="sandbox-badge"><span/> Sandbox · No real funds</span></div><div className="welcome-layout"><section><span className="eyebrow">YOUR GLOBAL MONEY WORKSPACE</span><h1>Explore what’s<br/>next for <em>your money.</em></h1><p className="welcome-description">Receive demo dollars, convert to naira, and follow a payout from start to finish. All in one Evolve workspace.</p><div className="welcome-actions"><button className="button primary large" onClick={start} disabled={!!busy}>{busy ? <span className="button-spinner"/> : <Icon name="arrow"/>}{busy ? 'Opening sandbox…' : 'Open sandbox'}</button><span>No signup.<br/>No real money.</span></div>{error && <div className="message error" role="alert"><Icon name="alert"/><p>{error}</p></div>}<div className="welcome-trust"><Icon name="shield"/><span>Your demo session has its own balances and transaction history.</span></div></section><section className="welcome-art" aria-label="Illustrative sandbox transaction flow"><div className="art-orbit"/><div className="art-dots"/><div className="illustration-card"><div className="mini-brand">evolve <span>DEMO</span></div><p>Start with demo dollars</p><strong>$100.00 <small>USD</small></strong><div className="illustration-divider"/><div className="illustration-row"><span>Example conversion</span><Icon name="exchange"/></div><strong className="illustration-ngn">₦99,000.00 <small>NGN</small></strong><p className="illustration-foot">Fictitious rate: ₦1,000 / $1<br/>Includes a $1 demo fee</p></div><div className="floating-note"><span><Icon name="check"/></span><div>Every step, accounted for<small>Try success and failure paths</small></div></div></section></div><footer className="welcome-footer">Evolve Bank is a development prototype. No live bank accounts, deposits or payouts are available.</footer></main>;

  return <div className="app-layout"><a className="skip-link" href="#main-content">Skip to content</a><aside className="sidebar"><Brand/><span className="nav-caption">YOUR WORKSPACE</span><nav aria-label="Main navigation">{pages.map(page => <button key={page.id} className={`nav-item ${view === page.id ? 'active' : ''}`} onClick={() => go(page.id)} aria-current={view === page.id ? 'page' : undefined}><Icon name={page.icon}/><span>{page.label}</span>{page.id === 'payouts' && pendingPayouts.length > 0 && <span className="nav-count">{pendingPayouts.length}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="sandbox-note"><Icon name="shield"/><strong>A space to explore</strong><p>Try the whole journey with simulated funds.</p><span>DEVELOPMENT SANDBOX</span></div><button className="session-exit" onClick={logout} disabled={!!busy || !!intent}><Icon name="exit"/> End demo session</button></div></aside><div className="workspace"><header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{view === 'funding' ? 'Add demo USD' : pages.find(page => page.id === view)?.label}</strong></div><div className="topbar-actions"><span className="sandbox-badge"><span/> Sandbox · No real funds</span><button className="icon-button" onClick={reload} disabled={!!busy} aria-label="Refresh balances"><Icon name="refresh" className={busy === 'refresh' ? 'spinning' : ''}/></button><span className="avatar" aria-label="Demo customer">EV</span></div></header><main className="content" id="main-content"><div className="context-note"><span className="status-dot"/>Simulated funds only. No real bank accounts or payments.<span className="last-sync">{lastSync && `Updated ${lastSync}`}</span></div>
    {intent && <section className="unresolved" aria-label="Unconfirmed request"><Icon name="clock"/><div><strong>Let’s confirm your last request</strong><p>Your {intent.kind} request is saved. Retrying checks the same transaction without creating a new one.</p><span className="intent-detail">{intent.body.amount && `${intent.body.amount} ${intent.kind === 'funding' ? 'USD' : 'NGN'} · `}Original request {new Date(intent.createdAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</span><div className="inline-actions"><button className="button secondary small" onClick={() => execute(intent)} disabled={!!busy}>Retry original request</button><button className="text-button" onClick={reload} disabled={!!busy}>Check activity</button></div></div></section>}
    {error && <div className="message error" role="alert"><Icon name="alert"/><p>{error}</p><button onClick={() => setError('')} aria-label="Dismiss error"><Icon name="close"/></button></div>}
    {notice && <div className="message success" role="status"><Icon name="check"/><p>{notice}</p><button onClick={() => setNotice('')} aria-label="Dismiss notification"><Icon name="close"/></button></div>}

    {view === 'overview' && <><PageHeading headingRef={heading} eyebrow="YOUR MONEY, IN MOTION" title="A world of possibilities." description="Your demo wallets, one simple workspace." action={<button className="button primary" onClick={() => go('funding')} disabled={locked}><Icon name="plus"/> Add demo USD</button>}/><div className="wallet-grid"><WalletCard wallet={usd} currency="USD" primary onAction={() => go('funding')} disabled={locked}/><WalletCard wallet={ngn} currency="NGN" onAction={() => go('payouts')} disabled={locked}/></div><div className="quick-actions"><button onClick={() => go('funding')} disabled={locked}><span className="quick-icon"><Icon name="plus"/></span><div><strong>Add demo funds</strong><small>Start with USD</small></div><Icon name="chevron"/></button><button onClick={() => go('exchange')} disabled={locked}><span className="quick-icon"><Icon name="exchange"/></span><div><strong>Exchange currency</strong><small>USD to NGN</small></div><Icon name="chevron"/></button><button onClick={() => go('payouts')} disabled={locked}><span className="quick-icon"><Icon name="arrow"/></span><div><strong>Make a demo payout</strong><small>Explore local transfers</small></div><Icon name="chevron"/></button></div><div className="overview-bottom"><section className="panel activity-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Your latest sandbox transactions</p></div><button className="text-button" onClick={() => go('activity')}>View all <Icon name="chevron"/></button></div><Activity operations={data.operations.slice(0, 5)} onAddFunds={() => go('funding')}/></section><aside className="journey"><span className="eyebrow">TAKE IT FOR A SPIN</span><h2>Your first money journey.</h2><p>Go from demo dollars to a completed naira payout.</p><ol>{[{title:'Add demo USD',detail:'Fund your dollar wallet',to:'funding'}, {title:'Convert to NGN',detail:'See the rate and fee upfront',to:'exchange'}, {title:'Simulate a payout',detail:'Choose a success or failure result',to:'payouts'}].map((step, index) => <li key={step.to}><span className={`step-number ${steps[index] ? 'done' : ''}`}>{steps[index] ? <Icon name="check"/> : `0${index + 1}`}</span><button onClick={() => go(step.to as View)}><strong>{step.title}</strong><span>{step.detail}</span></button></li>)}</ol><div className="journey-foot"><Icon name="shield"/>Every transaction leaves a record.</div></aside></div></>}

    {view === 'funding' && <><PageHeading headingRef={heading} eyebrow="START YOUR JOURNEY" title="A little demo money." description="Add fictitious dollars to explore the full experience."/><div className="form-layout"><section className="panel form-panel"><div className="panel-heading"><h2>Add demo USD</h2><span className="currency-pill">USD</span></div><form onSubmit={event => { event.preventDefault(); const invalid = amountError(fundingAmount); if (invalid) setError(invalid); else mutate('funding', '/sandbox/funding', { amount: fundingAmount }); }}><label className="field-label" htmlFor="funding-amount">Amount to add</label><div className="money-input"><span>$</span><input id="funding-amount" inputMode="decimal" autoComplete="off" value={fundingAmount} onChange={event => setFundingAmount(event.target.value)} disabled={locked} required aria-describedby="funding-hint"/><span>USD</span></div><div className="amount-presets">{['100.00', '500.00', '1000.00'].map(amount => <button key={amount} type="button" onClick={() => setFundingAmount(amount)} disabled={locked} className={fundingAmount === amount ? 'selected' : ''}>${amount.slice(0, -3)}</button>)}</div><p className="field-hint" id="funding-hint">This creates a simulated incoming payment. No bank account or card is required.</p><div className="summary-row"><span>Current USD balance</span><strong>{money(usd?.availableMinor ?? '0', 'USD')}</strong></div><button className="button primary full" disabled={locked}>{busy === 'funding' ? 'Adding demo USD…' : 'Add demo USD'}<Icon name="plus"/></button></form></section><aside className="explanation"><span className="explanation-icon"><Icon name="wallet"/></span><h2>Built for trying things out.</h2><p>Start with $100. Convert it at the fixed demo rate, then follow your payout into its final state.</p><div className="example"><span>$100.00 USD</span><Icon name="exchange"/><strong>₦99,000.00 NGN</strong></div><p className="small-copy">Example rate: ₦1,000 per dollar. A $1 demo conversion fee is included. This is not a market quote.</p></aside></div></>}

    {view === 'exchange' && <><PageHeading headingRef={heading} eyebrow="A CLEARER WAY TO CONVERT" title="Dollars to naira." description="Review the demo rate, fee and final amount before you confirm."/><div className="form-layout"><section className="panel form-panel"><div className="panel-heading"><h2>Exchange currency</h2><span className="subtle-tag">DEMO RATE</span></div><form onSubmit={event => { event.preventDefault(); void getQuote(); }}><div className="label-row"><label className="field-label" htmlFor="exchange-amount">You send</label><span>Available: {money(usd?.availableMinor ?? '0', 'USD')}</span></div><div className="money-input"><span>$</span><input id="exchange-amount" inputMode="decimal" autoComplete="off" value={exchangeAmount} onChange={event => { setExchangeAmount(event.target.value); setQuote(undefined); }} disabled={locked} required/><span>USD</span></div><div className="exchange-divider"><span/><Icon name="exchange"/><span/></div><div className="receive-box"><span>You receive</span><strong>{quote ? money(quote.amountNgnMinor, 'NGN') : '—'}<small>NGN</small></strong></div><div className="quote-facts"><div><span>Fixed demo rate</span><strong>$1.00 = ₦1,000.00</strong></div><div><span>Conversion fee</span><strong>{quote ? money(quote.feeUsdMinor, 'USD') : '$1.00'}</strong></div>{quote && <div><span>Quote expires in</span><strong className={quoteSeconds ? '' : 'expired'}>{quoteSeconds ? `${Math.floor(quoteSeconds / 60)}:${String(quoteSeconds % 60).padStart(2, '0')}` : 'Expired'}</strong></div>}</div>{!quote || !quoteSeconds ? <button className="button primary full" disabled={locked}>{busy === 'quote' ? 'Preparing quote…' : quote ? 'Get a new demo quote' : 'Get demo quote'}<Icon name="arrow"/></button> : <button className="button primary full" type="button" onClick={() => mutate('exchange', '/exchanges', { quoteId: quote.id })} disabled={locked}>Convert demo funds<Icon name="check"/></button>}<p className="form-footnote">All amounts are simulated. This rate is deliberately fictitious.</p></form></section><aside className="explanation"><span className="explanation-icon"><Icon name="exchange"/></span><h2>No guesswork.<br/>Every detail upfront.</h2><p>Your quote locks the demo rate and fee for two minutes. Confirm once to move demo USD into your NGN wallet.</p><ul className="feature-list"><li><Icon name="check"/> One confirmed quote, one conversion</li><li><Icon name="check"/> Fees shown before you confirm</li><li><Icon name="check"/> Updated balances and a clear record</li></ul><button className="text-button" onClick={() => go('funding')}>Need demo USD? Add some <Icon name="arrow"/></button></aside></div></>}

    {view === 'payouts' && <><PageHeading headingRef={heading} eyebrow="THE FINAL MILE" title="Naira, on its way." description="Reserve demo funds, then simulate how a payout ends."/><div className="form-layout"><section className="panel form-panel"><div className="panel-heading"><h2>Request a demo payout</h2><span className="currency-pill">NGN</span></div><form onSubmit={event => { event.preventDefault(); const invalid = amountError(payoutAmount); if (invalid) setError(invalid); else mutate('payout', '/payouts', { amount: payoutAmount, beneficiary: beneficiary.trim() }); }}><div className="label-row"><label className="field-label" htmlFor="payout-amount">Amount</label><button type="button" className="text-button compact" disabled={locked} onClick={() => setPayoutAmount(decimal(ngn?.availableMinor ?? '0'))}>Use available balance</button></div><div className="money-input"><span>₦</span><input id="payout-amount" inputMode="decimal" autoComplete="off" value={payoutAmount} onChange={event => setPayoutAmount(event.target.value)} required disabled={locked}/><span>NGN</span></div><label className="field-label spaced" htmlFor="beneficiary">Demo recipient label</label><input className="text-input" id="beneficiary" value={beneficiary} onChange={event => setBeneficiary(event.target.value)} maxLength={80} minLength={2} required disabled={locked} aria-describedby="recipient-hint"/><p className="field-hint" id="recipient-hint">Use a fictional name. No real account details are collected.</p><div className="quote-facts"><div><span>Available NGN</span><strong>{money(ngn?.availableMinor ?? '0', 'NGN')}</strong></div><div><span>Reserved for payouts</span><strong>{money(ngn?.heldMinor ?? '0', 'NGN')}</strong></div></div><button className="button primary full" disabled={locked}>{busy === 'payout' ? 'Reserving funds…' : 'Request demo payout'}<Icon name="arrow"/></button></form></section><aside className="explanation"><span className="explanation-icon"><Icon name="clock"/></span><h2>Watch the whole journey.</h2><p>A request reserves the amount first. Use the sandbox controls below to simulate the payout’s final result.</p><ul className="feature-list"><li><Icon name="check"/> Success completes the demo payout</li><li><Icon name="refresh"/> Failure returns the reserved funds</li><li><Icon name="clock"/> Pending funds cannot be spent again</li></ul></aside></div><section className="panel payouts-panel"><div className="panel-heading"><div><h2>Awaiting a simulated result</h2><p>These controls only affect your demo session.</p></div><span className="count-badge">{pendingPayouts.length}</span></div>{pendingPayouts.length ? <div className="pending-list">{pendingPayouts.map(op => <article key={op.id} className="pending-payout"><span className="transaction-icon payout"><Icon name="arrow"/></span><div className="pending-copy"><h3>{money(op.amountMinor, 'NGN')}</h3><p>{op.beneficiary} · {statusText(op)}</p><small>{op.id}</small></div><div className="settle-actions"><button className="button secondary small" disabled={locked} onClick={() => mutate('settlement', `/sandbox/payouts/${encodeURIComponent(op.id)}/settle`, { outcome: 'succeeded' })}><Icon name="check"/> Simulate success</button><button className="button neutral small" disabled={locked} onClick={() => mutate('settlement', `/sandbox/payouts/${encodeURIComponent(op.id)}/settle`, { outcome: 'failed' })}>Simulate failure</button></div></article>)}</div> : <div className="empty-inline"><Icon name="clock"/><p>No pending payouts. Request one above to explore the next step.</p></div>}</section></>}

    {view === 'activity' && <><PageHeading headingRef={heading} eyebrow="EVERY STEP, ACCOUNTED FOR" title="Your money’s journey." description="A complete record of your demo funding, conversions and payouts." action={<button className="button secondary" onClick={reload} disabled={!!busy}><Icon name="refresh"/> Refresh</button>}/><div className="activity-stats"><div><span>All transactions</span><strong>{data.operations.length}</strong></div><div><span>Completed</span><strong>{data.operations.filter(op => op.status === 'completed').length}</strong></div><div><span>Awaiting a result</span><strong>{data.operations.filter(op => ['pending', 'processing', 'review'].includes(op.status)).length}</strong></div></div><section className="panel activity-panel"><div className="panel-heading"><h2>Transaction history</h2><span className="subtle-tag">YOUR SESSION</span></div><Activity detailed operations={data.operations} onAddFunds={() => go('funding')}/></section></>}

    {view === 'reconciliation' && <><PageHeading headingRef={heading} eyebrow="CONFIDENCE IN EVERY RECORD" title="Make sure it adds up." description="Compare your transaction records with ledger postings and simulated payout results." action={<button className="button primary" onClick={reconcile} disabled={!!busy}>{busy === 'reconcile' ? <span className="button-spinner"/> : <Icon name="shield"/>}{busy === 'reconcile' ? 'Checking records…' : 'Run reconciliation'}</button>}/><section className="panel reconciliation-panel">{!report ? <div className="empty-state"><span className="empty-icon"><Icon name="shield"/></span><h3>Ready when you are</h3><p>Run a check after your money journey to see whether the records match. Any unresolved differences will appear here.</p><button className="button secondary" onClick={reconcile} disabled={!!busy}>Check my records</button></div> : <><div className={`reconcile-result ${report.ok ? 'matched' : 'mismatch'}`}><span><Icon name={report.ok ? 'check' : 'alert'}/></span><div><h2>{report.ok ? report.checkedOperations ? 'Your checked records match.' : 'No completed records to compare yet.' : 'Some records need attention.'}</h2><p>{report.ok ? 'The check found no differences in the records it compared.' : 'Review the differences below before continuing the affected transactions.'}</p></div></div><div className="activity-stats report-stats"><div><span>Transactions checked</span><strong>{report.checkedOperations}</strong></div><div><span>Pending</span><strong>{report.pendingOperations}</strong></div><div><span>Differences found</span><strong>{report.issues.length}</strong></div></div>{report.pendingOperations > 0 && <p className="report-note"><Icon name="clock"/>{report.pendingOperations} transaction{report.pendingOperations > 1 ? 's are' : ' is'} still pending. A matching check does not mean a pending payout has settled.</p>}{report.issues.length > 0 && <ul className="issue-list">{report.issues.map((issue, index) => <li key={`${issue.operationId}-${index}`}><strong>{issue.message}</strong><span>{issue.operationId}</span></li>)}</ul>}<p className="checked-at">Checked {new Date(report.checkedAt).toLocaleString('en-NG')} · Your sandbox session only</p></>}</section><div className="reconcile-explainer"><Icon name="shield"/><p>Reconciliation checks the history. It does not change balances or automatically resolve a disputed transaction.</p></div></>}

    <footer className="app-footer"><span>© 2026 Evolve Bank</span><span>Development prototype · Not a regulated deposit-taking institution</span></footer>
  </main></div></div>;
}

function Brand() { return <a className="brand" href="#overview" aria-label="Evolve Bank overview"><span className="brand-mark"><svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M7 8h15L10 14h11L7 21h15" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></span><span>evolve<small>BANK · SANDBOX</small></span></a>; }
function PageHeading({ eyebrow, title, description, action, headingRef }: { eyebrow: string; title: string; description: string; action?: ReactNode; headingRef: RefObject<HTMLHeadingElement | null> }) { return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1 tabIndex={-1} ref={headingRef}>{title}</h1><p>{description}</p></div>{action}</div>; }
function WalletCard({ wallet, currency, primary = false, onAction, disabled }: { wallet?: Wallet; currency: 'USD' | 'NGN'; primary?: boolean; onAction: () => void; disabled: boolean }) { return <section className={`wallet-card ${primary ? 'primary-wallet' : ''}`}><div className="wallet-top"><span className="wallet-currency"><span>{currency === 'USD' ? '$' : '₦'}</span><div>{currency === 'USD' ? 'US Dollar' : 'Nigerian Naira'}<small>{currency} WALLET</small></div></span><span className="wallet-demo">DEMO</span></div><div className="wallet-balance"><span>Available balance</span><strong>{money(wallet?.availableMinor ?? '0', currency)}</strong></div><div className="wallet-foot"><span>{BigInt(wallet?.heldMinor ?? '0') > 0n ? `${money(wallet?.heldMinor ?? '0', currency)} reserved` : 'Ready for your next move'}</span><button disabled={disabled} onClick={onAction} aria-label={currency === 'USD' ? 'Add demo dollars' : 'Create a demo naira payout'}><Icon name={currency === 'USD' ? 'plus' : 'arrow'}/></button></div></section>; }
