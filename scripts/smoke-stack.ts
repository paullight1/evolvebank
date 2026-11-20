import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const base = process.env.EVOLVE_BASE_URL ?? 'http://127.0.0.1:3000';
const stateFile = '.runtime/smoke-state.json';
async function request(path: string, body?: unknown, cookie?: string, key?: string, expected = body === undefined ? 200 : 201) {
  const res = await fetch(`${base}/api${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type':'application/json', ...(cookie ? { Cookie:cookie } : {}), ...(key ? {'Idempotency-Key':key}: {}) },
    ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
  const data = await res.json() as any;
  assert.equal(res.status,expected,`${path}: ${res.status} ${JSON.stringify(data)}`);
  return { res, data };
}
async function ready() {
  for (let n=0;n<60;n++) {
    try { const res=await fetch(`${base}/api/health`); if(res.ok) return; } catch { /* Wait for the stack startup. */ }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error('Sandbox stack did not become healthy');
}
await ready();
if (process.argv.includes('--resume')) {
  const saved = JSON.parse(await readFile(stateFile,'utf8'));
  const snapshot = (await request('/dashboard',undefined,saved.cookie)).data;
  assert.equal(snapshot.customer.id,saved.customerId);
  assert.equal(snapshot.operations.length,4);
  assert.ok(snapshot.wallets.every((w:any)=>w.availableMinor==='0' && w.heldMinor==='0'));
  const replay = await request('/sandbox/funding',{amount:'100.00'},saved.cookie,saved.fundingKey);
  assert.equal(replay.data.id,saved.fundingId);
  assert.equal((await request('/reconciliation',undefined,saved.cookie)).data.ok,true);
  console.log('PASS: app/ledger restart preserved session, postings, balances, and idempotent replay.');
} else {
  await request('/dashboard',undefined,undefined,undefined,401);
  const start = await request('/sandbox/sessions',{});
  const cookie = start.res.headers.get('set-cookie')!.split(';')[0];
  const fundingKey=randomUUID();
  const funded=await request('/sandbox/funding',{amount:'100.00'},cookie,fundingKey);
  assert.equal(funded.data.status,'completed');
  assert.equal((await request('/sandbox/funding',{amount:'100.00'},cookie,fundingKey)).data.id,funded.data.id);
  await request('/sandbox/funding',{amount:'101.00'},cookie,fundingKey,409);
  const quote=(await request('/quotes',{amount:'100.00'},cookie)).data;
  assert.equal(quote.amountNgnMinor,'9900000'); assert.equal(quote.feeUsdMinor,'100');
  const exchange=(await request('/exchanges',{quoteId:quote.id},cookie,randomUUID())).data;
  assert.equal(exchange.status,'completed');
  const pay=(await request('/payouts',{amount:'99000.00',beneficiary:'Sandbox recipient'},cookie,randomUUID())).data;
  assert.equal(pay.status,'pending');
  const pending=(await request('/dashboard',undefined,cookie)).data.wallets.find((w:any)=>w.currency==='NGN');
  assert.equal(pending.availableMinor,'0'); assert.equal(pending.heldMinor,'9900000');
  await request('/payouts',{amount:'1.00',beneficiary:'Sandbox recipient'},cookie,randomUUID(),409);
  const fail=(await request(`/sandbox/payouts/${pay.id}/settle`,{outcome:'failed'},cookie)).data;
  assert.equal(fail.status,'failed');
  assert.equal((await request(`/sandbox/payouts/${pay.id}/settle`,{outcome:'failed'},cookie)).data.id,pay.id);
  await request(`/sandbox/payouts/${pay.id}/settle`,{outcome:'succeeded'},cookie,undefined,409);
  const next=(await request('/payouts',{amount:'99000.00',beneficiary:'Sandbox recipient'},cookie,randomUUID())).data;
  assert.equal((await request(`/sandbox/payouts/${next.id}/settle`,{outcome:'succeeded'},cookie)).data.status,'completed');
  const final=(await request('/dashboard',undefined,cookie)).data;
  assert.equal(final.operations.length,4); assert.ok(final.wallets.every((w:any)=>w.availableMinor==='0' && w.heldMinor==='0'));
  const report=(await request('/reconciliation',undefined,cookie)).data;
  assert.equal(report.ok,true); assert.equal(report.checkedOperations,4); assert.equal(report.issues.length,0);
  const other=await request('/sandbox/sessions',{}); const otherCookie=other.res.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await request('/dashboard',undefined,otherCookie)).data.operations.length,0);
  await mkdir('.runtime',{recursive:true});
  await writeFile(stateFile,JSON.stringify({cookie,customerId:final.customer.id,fundingKey,fundingId:funded.data.id}),{mode:0o600});
  console.log('PASS: real Blnk/PostgreSQL $100 receipt -> $99 conversion + $1 fee -> NGN 99,000; payout failure releases once, success settles, duplicate requests are safe, reconciliation has zero differences.');
}
