import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresStore } from '../packages/storage/postgres.js';
import { BlnkLedger, LedgerError } from '../packages/ledger/blnk.js';
import { BankingService } from '../packages/banking/service.js';
import { account } from '../packages/banking/contracts.js';

const env = process.env;
if (!env.DATABASE_URL || !env.BLNK_URL || !env.BLNK_API_KEY) throw new Error('Sandbox database and Blnk configuration are required');
let store = new PostgresStore({ connectionString: env.DATABASE_URL, max: 8 });
let losePath = '';
let lostResponses = 0;
const realFetch: typeof fetch = async (url, init) => {
  const response = await fetch(url, init);
  if (init?.method === 'POST' && new URL(String(url)).pathname === losePath) {
    losePath = '';
    await response.text();
    lostResponses++;
    throw new Error('Deliberately lost successful real HTTP response');
  }
  return response;
};
const options = { baseUrl: env.BLNK_URL, apiKey: env.BLNK_API_KEY, fetch: realFetch };
const event = (op: any, outcome: 'succeeded' | 'failed') => ({
  id: randomUUID(), customerId: op.customerId, operationId: op.id,
  amountMinor: op.amountMinor, currency: 'NGN' as const, createdAt: new Date().toISOString(), outcome,
});

try {
  await store.initialize();
  let ledger = new BlnkLedger(store, options);
  await ledger.health();
  let service = new BankingService(store, ledger);
  const customer = await service.createCustomer();
  losePath = '/transactions';
  const funded = await service.fund(customer.id, '100.00', 'native-funding-001');
  assert.equal(funded.status, 'completed');
  assert.equal((await service.fund(customer.id, '100', 'native-funding-001')).id, funded.id);
  const quote = await service.quote(customer.id, '100.00');
  assert.equal(quote.amountNgnMinor, '9900000');
  losePath = '/transactions/bulk';
  const exchange = await service.exchange(customer.id, quote.id, 'native-exchange-001');
  assert.equal(exchange.status, 'completed');
  assert.equal(lostResponses, 2);
  assert.deepEqual((await service.dashboard(customer.id)).wallets, [
    { currency: 'USD', availableMinor: '0', heldMinor: '0' },
    { currency: 'NGN', availableMinor: '9900000', heldMinor: '0' },
  ]);
  const toFail = await service.payout(customer.id, '99000.00', 'Native sandbox recipient', 'native-payout-001');
  assert.deepEqual((await service.dashboard(customer.id)).wallets[1], { currency: 'NGN', availableMinor: '0', heldMinor: '9900000' });
  const failedEvent = event(toFail, 'failed');
  assert.equal((await service.settle(failedEvent)).status, 'failed');
  assert.equal((await service.settle(failedEvent)).status, 'failed');
  assert.deepEqual((await service.dashboard(customer.id)).wallets[1], { currency: 'NGN', availableMinor: '9900000', heldMinor: '0' });
  const toSucceed = await service.payout(customer.id, '99000.00', 'Native sandbox recipient', 'native-payout-002');
  const successEvent = event(toSucceed, 'succeeded');
  assert.equal((await service.settle(successEvent)).status, 'completed');
  assert.equal((await service.settle(successEvent)).status, 'completed');
  assert.deepEqual((await service.dashboard(customer.id)).wallets[1], { currency: 'NGN', availableMinor: '0', heldMinor: '0' });
  assert.equal((await service.reconciliation(customer.id)).ok, true);

  await store.close();
  store = new PostgresStore({ connectionString: env.DATABASE_URL, max: 8 });
  ledger = new BlnkLedger(store, options);
  service = new BankingService(store, ledger);
  const persisted = await service.dashboard(customer.id);
  assert.equal(persisted.operations.length, 4);
  assert.equal((await service.reconciliation(customer.id)).ok, true);
  assert.deepEqual(persisted.wallets[1], { currency: 'NGN', availableMinor: '0', heldMinor: '0' });
  console.log(JSON.stringify({ realBlnk: true, realPostgres: true, customer: customer.id, checkedOperations: persisted.operations.length, lostResponsesRecovered: lostResponses, failedPayoutReversed: true, successfulPayoutCommitted: true, restartVerified: true }));

  // Verify source atomic rollback semantics against real Blnk, not a double.
  const rollbackCustomer = await service.createCustomer();
  await service.fund(rollbackCustomer.id, '100.00', 'native-rollback-funding');
  const legs = [
    { source: account.customer(rollbackCustomer.id, 'USD'), destination: account.usdTreasury, currency: 'USD' as const, amountMinor: '9900' },
    { source: account.customer(rollbackCustomer.id, 'USD'), destination: account.fees, currency: 'USD' as const, amountMinor: '100' },
    { source: account.ngnTreasury, destination: account.customer(rollbackCustomer.id, 'NGN'), currency: 'NGN' as const, amountMinor: '100000000001' },
  ];
  const rollbackRef = `native-rollback-${randomUUID()}`;
  await assert.rejects(ledger.post(rollbackRef, legs), (error: unknown) => error instanceof LedgerError && error.code === 'LEDGER_INDETERMINATE');
  const rolledBack = await ledger.wallets(rollbackCustomer.id);
  assert.deepEqual(rolledBack, [
    { currency: 'USD', availableMinor: '10000', heldMinor: '0' },
    { currency: 'NGN', availableMinor: '0', heldMinor: '0' },
  ]);
  const verification = await ledger.verify(rollbackRef, legs);
  assert.equal(verification.ok, false);
  assert.ok(verification.issues.some(issue => issue.includes('reversal')));
  await assert.rejects(ledger.post(rollbackRef, legs), (error: unknown) => error instanceof LedgerError && error.code === 'LEDGER_INDETERMINATE');
  console.log(JSON.stringify({ atomicRollbackVerified: true, repeatRejected: true, balancesRestored: true }));
} catch (error) {
  if (error instanceof LedgerError) console.error(JSON.stringify({ code: error.code, message: error.message }));
  else if (error instanceof assert.AssertionError) console.error(error.message);
  else console.error(JSON.stringify({ name: error instanceof Error ? error.name : 'Error', message: 'Native smoke failed; inspect private logs.' }));
  process.exitCode = 1;
} finally {
  await store.close();
}
