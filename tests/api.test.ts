import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../apps/api/src/app.js';
import { Sessions } from '../apps/api/src/sessions.js';
import { signProviderEvent } from '../apps/api/src/webhooks.js';
import { BankingService } from '../packages/banking/service.js';
import { MemoryStore, MemoryLedger } from './helpers/memory.js';

test('HTTP API executes isolated sandbox flows and authenticates provider callbacks', async () => {
  const store = new MemoryStore(); const ledger = new MemoryLedger(); const banking = new BankingService(store,ledger);
  const secret = randomBytes(32).toString('hex');
  const app = await createApp({store,ledger,banking,sessions:new Sessions(store)}, {webhookSecret:secret,trustedOrigins:['http://localhost:4173'],rateLimit:10000});
  await app.listen(0,'127.0.0.1'); const base = await app.getUrl();
  const request = async (path:string,body?:unknown,cookie?:string,idempotency?:string,extra:Record<string,string>={}) => {
    const res = await fetch(`${base}/api${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(idempotency?{'Idempotency-Key':idempotency}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {res,data:await res.json() as any};
  };
  try {
    assert.equal((await request('/dashboard')).res.status,401);
    assert.equal((await request('/sandbox/sessions',{},undefined,undefined,{Origin:'https://attacker.example'})).res.status,403);
    const mixedCase = await fetch(`${base}/API/sandbox/sessions`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://attacker.example'},body:'{}'});
    assert.equal(mixedCase.status,403,'case-insensitive routes must keep origin protections');
    const formCase = await fetch(`${base}/API/sandbox/sessions`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:''});
    assert.equal(formCase.status,415,'case-insensitive routes must keep JSON-only protections');
    const a = await request('/sandbox/sessions',{}); assert.equal(a.res.status,201);
    const cookie = a.res.headers.get('set-cookie')!.split(';')[0];
    assert.match(a.res.headers.get('set-cookie')!,/HttpOnly/); assert.match(a.res.headers.get('set-cookie')!,/SameSite=Strict/i);
    const b = await request('/sandbox/sessions',{}); const other = b.res.headers.get('set-cookie')!.split(';')[0];
    assert.notEqual(a.data.customer.id,b.data.customer.id);
    const fundingKey = randomUUID();
    const funded = await request('/sandbox/funding',{amount:'100.00'},cookie,fundingKey); assert.equal(funded.res.status,201); assert.equal(funded.data.status,'completed');
    assert.equal((await request('/sandbox/funding',{amount:'100.00'},cookie,fundingKey)).data.id,funded.data.id);
    assert.equal((await request('/sandbox/funding',{amount:'101.00'},cookie,fundingKey)).res.status,409);
    assert.equal((await request('/sandbox/funding',{amount:'10.00'},cookie)).res.status,400);
    assert.equal((await request('/sandbox/funding',{amount:'1e5'},cookie,randomUUID())).res.status,400);
    const quote = await request('/quotes',{amount:'100.00'},cookie); assert.equal(quote.data.amountNgnMinor,'9900000');
    assert.equal((await request('/exchanges',{quoteId:quote.data.id},other,randomUUID())).res.status,404);
    const exchanged = await request('/exchanges',{quoteId:quote.data.id},cookie,randomUUID()); assert.equal(exchanged.data.status,'completed');
    const payout = await request('/payouts',{amount:'99000.00',beneficiary:'Sandbox recipient'},cookie,randomUUID()); assert.equal(payout.data.status,'pending');
    const dashboard = (await request('/dashboard',undefined,cookie)).data;
    assert.equal(dashboard.wallets.find((w:any)=>w.currency==='NGN').availableMinor,'0');
    assert.equal(dashboard.wallets.find((w:any)=>w.currency==='NGN').heldMinor,'9900000');
    assert.equal((await request(`/sandbox/payouts/${payout.data.id}/settle`,{outcome:'failed'},other)).res.status,404);
    const failed = await request(`/sandbox/payouts/${payout.data.id}/settle`,{outcome:'failed'},cookie); assert.equal(failed.data.status,'failed');
    assert.equal((await request(`/sandbox/payouts/${payout.data.id}/settle`,{outcome:'succeeded'},cookie)).res.status,409);
    const second = await request('/payouts',{amount:'99000.00',beneficiary:'Sandbox recipient'},cookie,randomUUID());
    const event = {id:randomUUID(),customerId:a.data.customer.id,operationId:second.data.id,outcome:'succeeded',amountMinor:'9900000',currency:'NGN',createdAt:new Date().toISOString()};
    const ts = Math.floor(Date.now()/1000).toString(); const raw = Buffer.from(JSON.stringify(event));
    const signature = signProviderEvent(raw,ts,secret);
    assert.equal((await request('/provider/webhook',event)).res.status,401);
    const settled = await request('/provider/webhook',event,undefined,undefined,{'X-Evolve-Timestamp':ts,'X-Evolve-Signature':signature}); assert.equal(settled.data.status,'completed');
    assert.equal((await request('/provider/webhook',event,undefined,undefined,{'X-Evolve-Timestamp':ts,'X-Evolve-Signature':signature})).data.id,second.data.id);
    assert.equal((await request('/reconciliation',undefined,cookie)).data.ok,true);
    assert.equal((await request('/dashboard',undefined,other)).data.operations.length,0);
    const logout = await fetch(`${base}/api/session`,{method:'DELETE',headers:{Cookie:cookie}}); assert.equal(logout.status,200);
    assert.equal((await request('/dashboard',undefined,cookie)).res.status,401);
  } finally { await app.close(); }
});
