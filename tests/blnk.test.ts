import assert from 'node:assert/strict';
import test from 'node:test';
import { BlnkLedger, LedgerError } from '../packages/ledger/blnk.js';
import { account, type LedgerLeg, type Store } from '../packages/banking/contracts.js';

/** HTTP and Store test doubles only; application runtime always uses PostgreSQL/Blnk. */
class TestStore implements Store {
  data = new Map<string, unknown>();
  tails = new Map<string, Promise<void>>();
  async get<T>(collection: string, id: string): Promise<T | undefined> { return structuredClone(this.data.get(`${collection}/${id}`)) as T | undefined; }
  async put<T>(collection: string, id: string, value: T): Promise<void> { this.data.set(`${collection}/${id}`, structuredClone(value)); }
  async list<T>(collection: string): Promise<T[]> { return [...this.data.entries()].filter(([key]) => key.startsWith(`${collection}/`)).map(([, value]) => structuredClone(value) as T); }
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.then(() => next);
    this.tails.set(key, tail);
    await previous;
    try { return await fn(); } finally { release(); if (this.tails.get(key) === tail) this.tails.delete(key); }
  }
}

type Row = Record<string, any>;
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function absent(code = 'TXN_NOT_FOUND'): Response { return json({ error_detail: { code, message: 'Not found' } }, 404); }

class HttpCoreDouble {
  ledgers: Row[] = [];
  balances = new Map<string, Row>();
  transactions = new Map<string, Row>();
  calls: Array<{ path: string; method: string; body: Row | undefined; headers: Headers; redirect: string | undefined }> = [];
  postBehavior?: (transactions: Row[], core: HttpCoreDouble) => Response | Promise<Response>;
  loseBalanceResponse = false;
  prefix = '';
  fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'http://blnk.test');
    const path = url.pathname.slice(this.prefix.length);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Row : undefined;
    const headers = new Headers(init?.headers);
    this.calls.push({ path, method, body, headers, redirect: init?.redirect });
    assert.equal(headers.get('X-Blnk-Key'), 'private-test-key');
    if (path === '/health') return json({ status: 'UP' });
    if (path === '/ledgers/filter') return json(this.ledgers.filter(row => row.name === body!.filters[0].value));
    if (path === '/ledgers' && method === 'POST') {
      const row = { ...body, ledger_id: `ldg_${this.ledgers.length + 1}` };
      this.ledgers.push(row); return json(row, 201);
    }
    if (path === '/balances/filter') {
      const rows = [...this.balances.values()].filter(row => body!.filters.every((f: Row) =>
        (f.field === 'meta_data.evolve_account' ? row.meta_data.evolve_account : row[f.field]) === f.value));
      return json(rows.length ? rows : null); // Pinned Blnk empty balances slice.
    }
    if (path === '/balances' && method === 'POST') {
      const row = { ...body, balance_id: `bln_${this.balances.size + 1}`, balance: 0, inflight_debit_balance: 0 };
      this.balances.set(row.balance_id, row);
      if (this.loseBalanceResponse) { this.loseBalanceResponse = false; throw new Error('Connection closed after creation'); }
      return json(row, 201);
    }
    if (path.startsWith('/balances/') && method === 'GET') {
      const row = this.balances.get(decodeURIComponent(path.slice('/balances/'.length)));
      return row ? json(row) : absent('BAL_NOT_FOUND');
    }
    if (path.startsWith('/transactions/reference/') && method === 'GET') {
      const ref = decodeURIComponent(path.slice('/transactions/reference/'.length));
      const row = this.transactions.get(ref);
      // Real pinned GET-by-reference omits precision and does not restore the flag.
      return row ? json({ ...row, precision: 0, allow_overdraft: false }) : absent();
    }
    if (path.startsWith('/transactions/') && method === 'GET') {
      const row = [...this.transactions.values()].find(row => row.transaction_id === decodeURIComponent(path.slice('/transactions/'.length)));
      return row ? json({ ...row, allow_overdraft: false }) : absent();
    }
    if ((path === '/transactions' || path === '/transactions/bulk') && method === 'POST') {
      const legs: Row[] = path.endsWith('/bulk') ? body!.transactions : [body!];
      if (this.postBehavior) return this.postBehavior(legs, this);
      this.apply(legs);
      return path.endsWith('/bulk') ? json({ batch_id: 'bulk_1', status: 'applied', transaction_count: legs.length }) : json(this.transactions.get(legs[0]!.reference), 201);
    }
    throw new Error(`Unexpected stub request ${method} ${path}`);
  };
  apply(legs: Row[], status = 'APPLIED'): void {
    for (const leg of legs) {
      assert.equal(this.transactions.has(leg.reference), false, `Duplicate posting ${leg.reference}`);
      const transaction = { ...leg, meta_data: { ...leg.meta_data, ...(leg.allow_overdraft ? { allow_overdraft: true } : {}) }, transaction_id: `txn_${this.transactions.size + 1}`, status };
      this.transactions.set(leg.reference, transaction);
      if (status === 'APPLIED') {
        const source = this.balances.get(leg.source)!;
        const destination = this.balances.get(leg.destination)!;
        source.balance = (BigInt(source.balance) - BigInt(leg.precise_amount)).toString();
        destination.balance = (BigInt(destination.balance) + BigInt(leg.precise_amount)).toString();
      }
    }
  }
}

async function setup() {
  const store = new TestStore();
  const core = new HttpCoreDouble();
  const ledger = new BlnkLedger(store, { baseUrl: 'http://blnk.test', apiKey: 'private-test-key', fetch: core.fetch });
  await ledger.ensureCustomer('alice');
  return { store, core, ledger };
}
const funding: LedgerLeg[] = [{ source: account.funding, destination: account.customer('alice', 'USD'), currency: 'USD', amountMinor: '10000' }];
const exchange: LedgerLeg[] = [
  { source: account.customer('alice', 'USD'), destination: account.usdTreasury, currency: 'USD', amountMinor: '9900' },
  { source: account.customer('alice', 'USD'), destination: account.fees, currency: 'USD', amountMinor: '100' },
  { source: account.ngnTreasury, destination: account.customer('alice', 'NGN'), currency: 'NGN', amountMinor: '9900000' },
];
const code = (expected: string) => (error: unknown) => error instanceof LedgerError && error.code === expected;
const posts = (core: HttpCoreDouble) => core.calls.filter(call => call.method === 'POST' && ['/transactions', '/transactions/bulk'].includes(call.path));

test('Blnk setup persists one ledger and account mappings; concurrent/restarted setup seeds bounded NGN once', async () => {
  const { core, ledger, store } = await setup();
  await Promise.all([ledger.ensureCustomer('alice'), ledger.ensureCustomer('bob')]);
  const restarted = new BlnkLedger(store, { baseUrl: 'http://blnk.test/', apiKey: 'private-test-key', fetch: core.fetch });
  await restarted.ensureCustomer('alice');
  assert.equal(core.ledgers.length, 1);
  assert.equal(core.balances.size, 12);
  assert.equal(posts(core).length, 1);
  const seed = posts(core)[0]!.body!;
  assert.equal(seed.precise_amount, 100000000000);
  assert.equal(seed.precision, 100);
  assert.equal(seed.allow_overdraft, true);
  assert.equal(seed.skip_queue, true);
  assert.deepEqual(await ledger.wallets('alice'), [
    { currency: 'USD', availableMinor: '0', heldMinor: '0' }, { currency: 'NGN', availableMinor: '0', heldMinor: '0' },
  ]);
});

test('Blnk account creation recovers a lost response through exact metadata lookup', async () => {
  const core = new HttpCoreDouble(); core.loseBalanceResponse = true;
  const ledger = new BlnkLedger(new TestStore(), { baseUrl: 'http://blnk.test', apiKey: 'private-test-key', fetch: core.fetch });
  await ledger.ensureCustomer('alice');
  assert.equal(core.balances.size, 9);
  assert.equal(core.calls.filter(call => call.path === '/balances' && call.method === 'POST').length, 9);
});

test('Blnk uncertain ledger creation is never duplicated and recovers when its original row appears', async () => {
  const store = new TestStore();
  const core = new HttpCoreDouble();
  let attempts = 0;
  let pending: Row | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    if (new URL(String(input)).pathname === '/ledgers' && init?.method === 'POST') {
      attempts++;
      pending = { ...JSON.parse(String(init.body)), ledger_id: 'ldg_delayed' };
      throw new Error('Ledger request timed out before its outcome became visible');
    }
    return core.fetch(input, init);
  };
  const ledger = new BlnkLedger(store, { baseUrl: 'http://blnk.test', apiKey: 'private-test-key', fetch: fetcher });
  await assert.rejects(ledger.ensureCustomer('alice'), code('LEDGER_UNAVAILABLE'));
  await assert.rejects(ledger.ensureCustomer('alice'), code('LEDGER_INDETERMINATE'));
  assert.equal(attempts, 1);
  core.ledgers.push(pending!);
  await ledger.ensureCustomer('alice');
  assert.equal(attempts, 1);
  assert.equal(core.ledgers.length, 1);
});

test('Blnk exact flow posts integer minor units with explicit synchronous atomic FX and separate held wallet', async () => {
  const { core, ledger } = await setup();
  await ledger.post('fund-1', funding);
  await ledger.post('fx-1', exchange);
  const bulk = core.calls.find(call => call.path === '/transactions/bulk')!.body!;
  assert.equal(bulk.atomic, true); assert.equal(bulk.skip_queue, true); assert.equal(bulk.run_async, false);
  assert.deepEqual(bulk.transactions.map((leg: Row) => leg.reference), ['fx-1:0', 'fx-1:1', 'fx-1:2']);
  assert.ok(bulk.transactions.every((leg: Row) => leg.allow_overdraft === false && leg.precision === 100 && leg.amount === undefined && leg.rate === undefined));
  assert.equal((await ledger.wallets('alice'))[1]!.availableMinor, '9900000');
  await ledger.post('reserve-1', [{ source: account.customer('alice', 'NGN'), destination: account.hold('alice'), currency: 'NGN', amountMinor: '9900000' }]);
  assert.deepEqual((await ledger.wallets('alice'))[1], { currency: 'NGN', availableMinor: '0', heldMinor: '9900000' });
  await ledger.post('settle-1', [{ source: account.hold('alice'), destination: account.paid, currency: 'NGN', amountMinor: '9900000' }]);
  assert.deepEqual((await ledger.wallets('alice'))[1], { currency: 'NGN', availableMinor: '0', heldMinor: '0' });
  assert.deepEqual(await ledger.verify('fx-1', exchange), { ok: true, issues: [] });
});

test('Blnk repeated/concurrent requests use stable references and one HTTP posting', async () => {
  const { core, ledger } = await setup();
  await Promise.all([ledger.post('fund-1', funding), ledger.post('fund-1', funding)]);
  await ledger.post('fund-1', funding);
  assert.equal(posts(core).length, 2); // bootstrap + funding
  assert.equal((await ledger.wallets('alice'))[0]!.availableMinor, '10000');
});

test('Blnk replay and verification survive JSONB object key reordering', async () => {
  const { core, ledger, store } = await setup();
  await ledger.post('fund-1', funding);
  await ledger.post('fx-1', exchange);
  // PostgreSQL JSONB restores semantic objects, not their original property order.
  const roundtrip = <T>(value: T): T => JSON.parse(JSON.stringify(value), (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item) as T;
  const reorderedFunding = roundtrip(funding);
  const reorderedExchange = roundtrip(exchange);
  assert.notDeepEqual(Object.keys(reorderedFunding[0]!), Object.keys(funding[0]!));
  for (const [key, value] of store.data) store.data.set(key, roundtrip(value));
  const restarted = new BlnkLedger(store, { baseUrl: 'http://blnk.test', apiKey: 'private-test-key', fetch: core.fetch });
  await restarted.post('fund-1', reorderedFunding);
  await restarted.post('fx-1', reorderedExchange);
  assert.deepEqual(await restarted.verify('fund-1', reorderedFunding), { ok: true, issues: [] });
  assert.deepEqual(await restarted.verify('fx-1', reorderedExchange), { ok: true, issues: [] });
  assert.equal(posts(core).length, 3); // bootstrap, funding, FX; no replay writes.
});

test('Blnk lost single response is recovered by exact reference lookup without another write', async () => {
  const { core, ledger } = await setup();
  core.postBehavior = (legs, server) => { server.apply(legs); throw new Error('Socket closed after commit'); };
  await ledger.post('fund-1', funding);
  await ledger.post('fund-1', funding);
  assert.equal(posts(core).length, 2);
  assert.equal((await ledger.wallets('alice'))[0]!.availableMinor, '10000');
});

test('Blnk lost bulk response is recovered only after every exact leg is applied', async () => {
  const { core, ledger } = await setup();
  await ledger.post('fund-1', funding);
  core.postBehavior = (legs, server) => { server.apply(legs); throw new Error('Lost atomic batch response'); };
  await ledger.post('fx-1', exchange);
  await ledger.post('fx-1', exchange);
  assert.equal(core.calls.filter(call => call.path === '/transactions/bulk').length, 1);
  assert.equal((await ledger.wallets('alice'))[1]!.availableMinor, '9900000');
});

test('Blnk conflicting local reference is rejected without ledger side effects', async () => {
  const { core, ledger } = await setup();
  await ledger.post('fund-1', funding);
  await assert.rejects(ledger.post('fund-1', [{ ...funding[0]!, amountMinor: '11000' }]), code('LEDGER_CONFLICT'));
  assert.equal(posts(core).length, 2);
});

test('Blnk conflicting preexisting remote reference is not treated as replay success', async () => {
  const { core, ledger } = await setup();
  await ledger.post('fund-1', funding);
  const original = core.transactions.get('fund-1:0')!;
  core.transactions.set('collision:0', { ...original, reference: 'collision:0', precise_amount: 42 });
  await assert.rejects(ledger.post('collision', funding), code('LEDGER_INDETERMINATE'));
  assert.equal(posts(core).length, 2);
});

test('Blnk rejects missing or queued legs even when the bulk summary claims applied', async () => {
  for (const mode of ['missing', 'queued'] as const) {
    const { core, ledger } = await setup();
    await ledger.post('fund-1', funding);
    core.postBehavior = (legs, server) => { if (mode === 'queued') server.apply(legs, 'QUEUED'); return json({ status: 'applied', transaction_count: legs.length }); };
    await assert.rejects(ledger.post('fx-1', exchange), code('LEDGER_INDETERMINATE'));
    await assert.rejects(ledger.post('fx-1', exchange), code('LEDGER_INDETERMINATE'));
    assert.equal(core.calls.filter(call => call.path === '/transactions/bulk').length, 1);
    assert.equal((await ledger.verify('fx-1', exchange)).ok, false);
  }
});

test('Blnk partial atomic result is retained for review and never resent', async () => {
  const { core, ledger, store } = await setup();
  await ledger.post('fund-1', funding);
  core.postBehavior = (legs, server) => { server.apply([legs[0]!]); return json({ status: 'failed', error: 'partial rollback error' }, 500); };
  await assert.rejects(ledger.post('fx-1', exchange), code('LEDGER_INDETERMINATE'));
  const restarted = new BlnkLedger(store, { baseUrl: 'http://blnk.test', apiKey: 'private-test-key', fetch: core.fetch });
  await assert.rejects(restarted.post('fx-1', exchange), code('LEDGER_INDETERMINATE'));
  assert.equal(core.calls.filter(call => call.path === '/transactions/bulk').length, 1);
  assert.equal((await store.get<Row>('ledger_postings', 'fx-1'))!.state, 'review');
});

test('Blnk verification detects compensating refunds even though original transaction remains APPLIED', async () => {
  const { core, ledger } = await setup();
  await ledger.post('fund-1', funding);
  await ledger.post('fx-1', exchange);
  const original = core.transactions.get('fx-1:0')!;
  core.transactions.set(`${original.transaction_id}_refund`, { ...original, reference: `${original.transaction_id}_refund`, source: original.destination, destination: original.source });
  const result = await ledger.verify('fx-1', exchange);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.includes('reversal')));
  await assert.rejects(ledger.post('fx-1', exchange), code('LEDGER_INDETERMINATE'));
});

test('Blnk verifies account IDs, currency and overdraft flags, not merely transaction status', async () => {
  const { core, ledger } = await setup();
  await ledger.post('fund-1', funding);
  const original = core.transactions.get('fund-1:0')!;
  core.transactions.set('fund-1:0', { ...original, destination: 'somebody-else', currency: 'NGN', allow_overdraft: false });
  assert.equal((await ledger.verify('fund-1', funding)).ok, false);
});

test('Blnk rejects unsafe/noninteger/zero monetary inputs before any HTTP request', async () => {
  const { core, ledger } = await setup();
  const before = core.calls.length;
  for (const amountMinor of ['9007199254740992', '1.5', '-1', '0', '1e4', '0100']) {
    await assert.rejects(ledger.post('invalid', [{ ...funding[0]!, amountMinor }]), code('LEDGER_INVALID_INPUT'));
  }
  assert.equal(core.calls.length, before);
});

test('Blnk preserves large integer JSON wallet balances as exact decimal strings', async () => {
  const { store, core } = await setup();
  const usd = await store.get<Row>('ledger_accounts', account.customer('alice', 'USD'));
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).endsWith(`/balances/${usd!.balanceId}`)) return new Response(`{"balance_id":"${usd!.balanceId}","currency":"USD","ledger_id":"${usd!.ledgerId}","balance":900719925474099312345,"inflight_debit_balance":2}`);
    return core.fetch(input, init);
  };
  const ledger = new BlnkLedger(store, { baseUrl: 'http://blnk.test', apiKey: 'private-test-key', fetch: fetcher });
  assert.equal((await ledger.wallets('alice'))[0]!.availableMinor, '900719925474099312343');
});

test('Blnk cannot seed treasury twice under another reference or enable customer overdraft', async () => {
  const { core, ledger } = await setup();
  await assert.rejects(ledger.post('another-seed', [{ source: 'system:NGN:funding', destination: account.ngnTreasury, currency: 'NGN', amountMinor: '100000000000' }]), code('LEDGER_INVALID_INPUT'));
  await assert.rejects(ledger.post('bad-funding', [{ source: account.funding, destination: account.usdTreasury, currency: 'USD', amountMinor: '100' }]), code('LEDGER_INVALID_INPUT'));
  assert.equal(posts(core).length, 1);
});

test('Blnk transport preserves a configured path prefix and disables redirects', async () => {
  const core = new HttpCoreDouble(); core.prefix = '/core';
  const ledger = new BlnkLedger(new TestStore(), { baseUrl: 'http://blnk.test/core/', apiKey: 'private-test-key', fetch: core.fetch });
  await ledger.health();
  assert.equal(core.calls[0]!.path, '/health');
  assert.equal(core.calls[0]!.redirect, 'error');
});

test('Blnk generic/misrouted 404 is not mistaken for an absent transaction', async () => {
  const { core, store } = await setup();
  const ledger = new BlnkLedger(store, { baseUrl: 'http://blnk.test/wrong', apiKey: 'private-test-key', fetch: async () => new Response('Not found', { status: 404 }) });
  await assert.rejects(ledger.post('fund-1', funding), code('LEDGER_UNAVAILABLE'));
  assert.equal(posts(core).length, 1);
});

test('Blnk upstream failures never leak the private key, body, URLs or fetch exception', async () => {
  const ledger = new BlnkLedger(new TestStore(), { baseUrl: 'http://blnk.test', apiKey: 'private-test-key', fetch: async () => {
    throw new Error('private-test-key http://internal-ledger/ credential debug dump');
  } });
  await assert.rejects(ledger.health(), (error: unknown) => error instanceof Error && !/private-test-key|internal-ledger|debug dump/.test(error.stack ?? ''));
  const httpError = new BlnkLedger(new TestStore(), { baseUrl: 'http://blnk.test', apiKey: 'private-test-key', fetch: async () => json({ error_detail: { code: 'AUTH_INVALID_API_KEY', message: 'private-test-key' }, debug: 'private-test-key' }, 401) });
  await assert.rejects(httpError.health(), (error: unknown) => error instanceof Error && !/private-test-key/.test(error.stack ?? ''));
});
