import test from 'node:test';
import assert from 'node:assert/strict';
import { BankingService } from '../packages/banking/service.js';
import { BankingError } from '../packages/banking/errors.js';
import { account, type Operation, type ProviderEvent } from '../packages/banking/contracts.js';
import { MemoryLedger, MemoryStore } from './helpers/memory.js';

function fixture() {
  const store = new MemoryStore();
  const ledger = new MemoryLedger();
  let now = Date.parse('2026-11-20T12:00:00.000Z');
  const service = new BankingService(store, ledger, { now: () => now });
  return { store, ledger, service, advance: (ms: number) => { now += ms; } };
}
async function ready() {
  const f = fixture();
  const customer = await f.service.createCustomer();
  await f.service.fund(customer.id, '100.00', 'funding-key-001');
  const quote = await f.service.quote(customer.id, '100.00');
  const exchange = await f.service.exchange(customer.id, quote.id, 'exchange-key-001');
  return { ...f, customer, quote, exchange };
}
function event(op: Operation, outcome: 'succeeded' | 'failed' = 'succeeded', id = 'event-001'): ProviderEvent {
  return { id, customerId: op.customerId, operationId: op.id, outcome, amountMinor: op.amountMinor, currency: 'NGN', createdAt: '2026-11-20T12:00:00.000Z' };
}
function code(expected: string) { return (error: unknown) => error instanceof BankingError && error.code === expected; }
async function wallet(f: ReturnType<typeof fixture>, id: string, currency: 'USD' | 'NGN') {
  return (await f.service.dashboard(id)).wallets.find((w) => w.currency === currency)!;
}

test('complete $100 -> NGN 99,000 payout with one ledger and balanced per-currency postings', async () => {
  const f = await ready();
  assert.equal(f.quote.amountUsdMinor, '10000');
  assert.equal(f.quote.feeUsdMinor, '100');
  assert.equal(f.quote.amountNgnMinor, '9900000');
  assert.equal((await wallet(f, f.customer.id, 'USD')).availableMinor, '0');
  const op = await f.service.payout(f.customer.id, '99000.00', 'Sandbox recipient', 'payout-key-001');
  assert.equal(op.status, 'pending');
  assert.deepEqual(await wallet(f, f.customer.id, 'NGN'), { currency: 'NGN', availableMinor: '0', heldMinor: '9900000' });
  const done = await f.service.settle(event(op));
  assert.equal(done.status, 'completed');
  assert.equal((await wallet(f, f.customer.id, 'NGN')).heldMinor, '0');
  assert.equal(f.ledger.amounts.get(account.fees), 100n);
  assert.equal(f.ledger.amounts.get(account.paid), 9900000n);
  const report = await f.service.reconciliation(f.customer.id);
  assert.equal(report.ok, true);
  assert.equal(report.checkedOperations, 3);
  assert.equal(report.pendingOperations, 0);
  assert.deepEqual(report.issues, []);
});

test('failed payout releases reserved NGN exactly once across repeat event IDs', async () => {
  const f = await ready();
  const op = await f.service.payout(f.customer.id, '99000', 'Sandbox recipient', 'payout-key-001');
  const failed = await f.service.settle(event(op, 'failed'));
  assert.equal(failed.status, 'failed');
  const count = f.ledger.postings.size;
  await f.service.settle(event(op, 'failed'));
  await f.service.settle(event(op, 'failed', 'event-retry'));
  assert.equal(f.ledger.postings.size, count);
  assert.deepEqual(await wallet(f, f.customer.id, 'NGN'), { currency: 'NGN', availableMinor: '9900000', heldMinor: '0' });
  assert.equal((await f.service.reconciliation(f.customer.id)).ok, true);
});

test('same idempotency request returns the same operation; a changed payload or kind conflicts', async () => {
  const f = fixture();
  const c = await f.service.createCustomer();
  const first = await f.service.fund(c.id, '100', 'request-key-001');
  const second = await f.service.fund(c.id, '100.00', 'request-key-001');
  assert.equal(first.id, second.id);
  assert.equal((await wallet(f, c.id, 'USD')).availableMinor, '10000');
  await assert.rejects(f.service.fund(c.id, '101', 'request-key-001'), code('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(f.service.payout(c.id, '100', 'Sandbox recipient', 'request-key-001'), code('IDEMPOTENCY_CONFLICT'));
  assert.equal(f.ledger.postings.size, 1);
});

test('quote expiry is enforced at its exact boundary', async () => {
  const f = fixture();
  const c = await f.service.createCustomer();
  await f.service.fund(c.id, '100', 'funding-key-001');
  const q = await f.service.quote(c.id, '100');
  f.advance(120_000);
  await assert.rejects(f.service.exchange(c.id, q.id, 'exchange-key-001'), code('QUOTE_EXPIRED'));
  assert.equal((await wallet(f, c.id, 'USD')).availableMinor, '10000');
});

test('quote is bound to its customer and cannot be consumed twice with different keys', async () => {
  const f = await ready();
  const other = await f.service.createCustomer();
  await assert.rejects(f.service.exchange(other.id, f.quote.id, 'exchange-key-002'), code('QUOTE_NOT_FOUND'));
  await assert.rejects(f.service.exchange(f.customer.id, f.quote.id, 'exchange-key-002'), code('QUOTE_USED'));
  assert.equal((await f.service.exchange(f.customer.id, f.quote.id, 'exchange-key-001')).id, f.exchange.id);
});

test('insufficient balance does not consume the quote', async () => {
  const f = fixture();
  const c = await f.service.createCustomer();
  const q = await f.service.quote(c.id, '100');
  await assert.rejects(f.service.exchange(c.id, q.id, 'exchange-key-001'), code('INSUFFICIENT_FUNDS'));
  await f.service.fund(c.id, '100', 'funding-key-001');
  assert.equal((await f.service.exchange(c.id, q.id, 'exchange-key-001')).status, 'completed');
});

test('concurrent withdrawals cannot spend the same balance', async () => {
  const f = await ready();
  const outcomes = await Promise.allSettled([
    f.service.payout(f.customer.id, '80000', 'Recipient A', 'payout-key-001'),
    f.service.payout(f.customer.id, '80000', 'Recipient B', 'payout-key-002'),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((r) => r.status === 'rejected');
  assert.ok(rejected?.status === 'rejected' && code('INSUFFICIENT_FUNDS')(rejected.reason));
  assert.deepEqual(await wallet(f, f.customer.id, 'NGN'), { currency: 'NGN', availableMinor: '1900000', heldMinor: '8000000' });
});

test('lost ledger response is recoverable with the original key after service restart', async () => {
  const f = fixture();
  const c = await f.service.createCustomer();
  f.ledger.loseNextResponse = true;
  await assert.rejects(f.service.fund(c.id, '100', 'funding-key-001'), code('LEDGER_UNAVAILABLE'));
  assert.equal((await wallet(f, c.id, 'USD')).availableMinor, '10000');
  await assert.rejects(f.service.fund(c.id, '100', 'funding-key-002'), code('OPERATION_REQUIRES_REVIEW'));
  assert.equal((await f.service.reconciliation(c.id)).ok, false);
  const restarted = new BankingService(f.store, f.ledger);
  const recovered = await restarted.fund(c.id, '100', 'funding-key-001');
  assert.equal(recovered.status, 'completed');
  assert.equal(f.ledger.postings.size, 1);
  assert.equal((await wallet(f, c.id, 'USD')).availableMinor, '10000');
  assert.equal((await restarted.reconciliation(c.id)).ok, true);
});

test('exchange recovery retains the consumed quote even after its expiry', async () => {
  const f = fixture();
  const c = await f.service.createCustomer();
  await f.service.fund(c.id, '100', 'funding-key-001');
  const q = await f.service.quote(c.id, '100');
  f.ledger.loseNextResponse = true;
  await assert.rejects(f.service.exchange(c.id, q.id, 'exchange-key-001'), code('LEDGER_UNAVAILABLE'));
  f.advance(180_000);
  assert.equal((await f.service.exchange(c.id, q.id, 'exchange-key-001')).status, 'completed');
  assert.equal((await wallet(f, c.id, 'NGN')).availableMinor, '9900000');
  assert.equal(f.ledger.postings.size, 2);
});

test('settlement recovery cannot change an already accepted outcome', async () => {
  const f = await ready();
  const op = await f.service.payout(f.customer.id, '99000', 'Sandbox recipient', 'payout-key-001');
  f.ledger.loseNextResponse = true;
  await assert.rejects(f.service.settle(event(op, 'failed')), code('LEDGER_UNAVAILABLE'));
  await assert.rejects(f.service.settle(event(op, 'succeeded', 'event-success-late')), code('PAYOUT_OUTCOME_CONFLICT'));
  assert.equal((await f.service.settle(event(op, 'failed'))).status, 'failed');
  assert.equal((await wallet(f, f.customer.id, 'NGN')).availableMinor, '9900000');
  assert.equal((await f.service.reconciliation(f.customer.id)).ok, true);
});

test('mismatched amount, currency, ownership or event body cannot settle a payout', async () => {
  const f = await ready();
  const op = await f.service.payout(f.customer.id, '99000', 'Sandbox recipient', 'payout-key-001');
  await assert.rejects(f.service.settle({ ...event(op), amountMinor: '1' }), code('PROVIDER_EVENT_MISMATCH'));
  await assert.rejects(f.service.settle({ ...event(op), currency: 'USD' } as unknown as ProviderEvent), code('INVALID_PROVIDER_EVENT'));
  const other = await f.service.createCustomer();
  await assert.rejects(f.service.settle({ ...event(op), customerId: other.id }), code('PAYOUT_NOT_FOUND'));
  await f.service.settle(event(op));
  await assert.rejects(f.service.settle({ ...event(op), outcome: 'failed' }), code('PROVIDER_EVENT_CONFLICT'));
});

test('provider event identity is global and cannot be reused for a different payout', async () => {
  const f = await ready();
  const first = await f.service.payout(f.customer.id, '40000', 'Recipient A', 'payout-key-001');
  const second = await f.service.payout(f.customer.id, '40000', 'Recipient B', 'payout-key-002');
  await f.service.settle(event(first));
  await assert.rejects(f.service.settle(event(second)), code('PROVIDER_EVENT_CONFLICT'));
  assert.equal((await wallet(f, f.customer.id, 'NGN')).heldMinor, '4000000');
});

test('event replay tolerates PostgreSQL JSONB object key reordering', async () => {
  const f = await ready();
  const op = await f.service.payout(f.customer.id, '99000', 'Sandbox recipient', 'payout-key-001');
  await f.service.settle(event(op));
  const original = event(op);
  const reordered = Object.fromEntries(Object.entries(original).sort(([a], [b]) => a.localeCompare(b)));
  await f.store.put('provider_events', original.id, reordered);
  assert.equal((await f.service.settle(original)).status, 'completed');
});

test('a stored provider decision survives a crash before updating the operation', async () => {
  const f = await ready();
  const op = await f.service.payout(f.customer.id, '99000', 'Sandbox recipient', 'payout-key-001');
  const originalPut = f.store.put.bind(f.store);
  let crash = true;
  f.store.put = async (collection, id, value) => {
    const operation = value as Operation;
    if (crash && collection === 'operations' && operation.outcome) {
      crash = false;
      throw new Error('Simulated crash after storing the provider event');
    }
    await originalPut(collection, id, value);
  };
  await assert.rejects(f.service.settle(event(op, 'failed')), /Simulated crash/);
  await assert.rejects(f.service.settle(event(op, 'succeeded', 'late-success-event')), code('PAYOUT_OUTCOME_CONFLICT'));
  assert.equal((await f.service.settle(event(op, 'failed'))).status, 'failed');
  assert.equal((await wallet(f, f.customer.id, 'NGN')).availableMinor, '9900000');
});

test('failed terminal payout rejects late success and successful payout rejects late failure', async () => {
  for (const outcome of ['failed', 'succeeded'] as const) {
    const f = await ready();
    const op = await f.service.payout(f.customer.id, '99000', 'Sandbox recipient', 'payout-key-001');
    await f.service.settle(event(op, outcome));
    await assert.rejects(f.service.settle(event(op, outcome === 'failed' ? 'succeeded' : 'failed', 'opposite-event')), code('PAYOUT_OUTCOME_CONFLICT'));
    assert.equal((await f.service.reconciliation(f.customer.id)).ok, true);
  }
});

test('reconciliation catches missing postings and unexpected changes to ledger balances', async () => {
  const f = await ready();
  assert.equal((await f.service.reconciliation(f.customer.id)).ok, true);
  f.ledger.amounts.set(account.customer(f.customer.id, 'NGN'), 9900001n);
  const balanceReport = await f.service.reconciliation(f.customer.id);
  assert.equal(balanceReport.ok, false);
  assert.ok(balanceReport.issues.some((i) => /balance/i.test(i.message)));
  f.ledger.postings.delete(f.exchange.postings[0]!.reference);
  const missing = await f.service.reconciliation(f.customer.id);
  assert.ok(missing.issues.some((i) => /missing|differs/i.test(i.message)));
});

test('reconciliation catches a missing simulated provider statement', async () => {
  const f = await ready();
  const op = await f.service.payout(f.customer.id, '99000', 'Sandbox recipient', 'payout-key-001');
  await f.service.settle(event(op));
  f.store.documents.delete('provider_events/event-001');
  const report = await f.service.reconciliation(f.customer.id);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => /provider/i.test(i.message)));
});

test('detected reconciliation discrepancies block new transfers until a clean check', async () => {
  const f = await ready();
  f.ledger.amounts.set(account.customer(f.customer.id, 'NGN'), 9900001n);
  assert.equal((await f.service.reconciliation(f.customer.id)).ok, false);
  await assert.rejects(f.service.payout(f.customer.id, '100', 'Sandbox recipient', 'payout-key-001'), code('RECONCILIATION_REQUIRED'));
  f.ledger.amounts.set(account.customer(f.customer.id, 'NGN'), 9900000n);
  assert.equal((await f.service.reconciliation(f.customer.id)).ok, true);
  assert.equal((await f.service.payout(f.customer.id, '100', 'Sandbox recipient', 'payout-key-001')).status, 'pending');
});

test('amounts reject floats, exponent strings, extra precision and excessive sandbox amounts', async () => {
  const f = fixture();
  const c = await f.service.createCustomer();
  for (const value of ['', '0', '-1', '1e2', 'NaN', ' 100 ', '01.00', '1.001', '10000.01', 100, null]) {
    await assert.rejects(f.service.fund(c.id, value as string, 'funding-key-001'), code('INVALID_AMOUNT'));
  }
  for (const value of ['0.01', '1', '1.00']) await assert.rejects(f.service.quote(c.id, value), code('INVALID_AMOUNT'));
  assert.equal((await f.service.quote(c.id, '1.01')).amountNgnMinor, '1000');
  await assert.rejects(f.service.fund(c.id, '100', ''), code('INVALID_IDEMPOTENCY_KEY'));
});

test('unknown customers cannot read balances or create quote and mutation records', async () => {
  const f = fixture();
  await assert.rejects(f.service.dashboard('missing'), code('CUSTOMER_NOT_FOUND'));
  await assert.rejects(f.service.quote('missing', '100'), code('CUSTOMER_NOT_FOUND'));
  await assert.rejects(f.service.fund('missing', '100', 'funding-key-001'), code('CUSTOMER_NOT_FOUND'));
  assert.equal((await f.store.list('operations')).length, 0);
});
