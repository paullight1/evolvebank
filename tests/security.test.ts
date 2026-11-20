import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { verifyProviderEvent, signProviderEvent } from '../apps/api/src/webhooks.js';
import { Sessions, readSessionCookie } from '../apps/api/src/sessions.js';
import { MemoryStore } from './helpers/memory.js';

test('provider verification authenticates exact bytes and rejects stale, future, malformed and altered events', () => {
  const secret = randomBytes(32).toString('hex'); const now = Date.now(); const ts = Math.floor(now/1000).toString();
  const event = { id: 'evt1', customerId: 'customer1', operationId: 'pay1', outcome: 'succeeded', amountMinor: '9900000', currency: 'NGN', createdAt: new Date(now).toISOString() };
  const raw = Buffer.from(JSON.stringify(event)); const signature = signProviderEvent(raw, ts, secret);
  assert.deepEqual(verifyProviderEvent(raw, ts, signature, secret, now), event);
  assert.throws(() => verifyProviderEvent(Buffer.from(JSON.stringify({ ...event, amountMinor: '1' })), ts, signature, secret, now));
  for (const bad of ['', 'a', 'f'.repeat(64), 'gg'.repeat(32)]) assert.throws(() => verifyProviderEvent(raw, ts, bad, secret, now));
  for (const delta of [-301,301]) {
    const timestamp = String(Math.floor(now/1000)+delta);
    assert.throws(() => verifyProviderEvent(raw, timestamp, signProviderEvent(raw,timestamp,secret), secret, now));
  }
  const invalid = Buffer.from(JSON.stringify({ ...event, amountMinor: 1 }));
  assert.throws(() => verifyProviderEvent(invalid, ts, signProviderEvent(invalid,ts,secret), secret, now));
});

test('sessions store only token digests, expire, revoke, and reject ambiguous cookies', async () => {
  let now = 1000; const store = new MemoryStore(); const sessions = new Sessions(store, () => now);
  const { token, session } = await sessions.create('customer1');
  assert.notEqual(token,session.id);
  assert.equal((await sessions.resolve(token))?.customerId,'customer1');
  assert.equal((await store.list('sessions')).length,1);
  assert.equal(JSON.stringify(await store.list('sessions')).includes(token),false);
  assert.equal(readSessionCookie(`evolve_sandbox_session=${token}`),token);
  assert.equal(readSessionCookie(`evolve_sandbox_session=${token}; evolve_sandbox_session=bad`),undefined);
  await sessions.revoke(token); assert.equal(await sessions.resolve(token),undefined);
  const second = await sessions.create('customer1'); now += 86400001;
  assert.equal(await sessions.resolve(second.token),undefined);
});
