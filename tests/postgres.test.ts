import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import { PostgresStore } from '../packages/storage/postgres.js';

test('real PostgreSQL persists records, serializes workers and recovers disconnected clients', { timeout: 90000 }, async (t) => {
  const probe = createServer(); await new Promise<void>(r => probe.listen(0,'127.0.0.1',r));
  const port = (probe.address() as {port:number}).port; await new Promise<void>(r=>probe.close(()=>r()));
  const dir = await mkdtemp(join(tmpdir(),'evolve-pg-'));
  const password = randomBytes(20).toString('hex');
  const diagnostics: string[] = [];
  let phase = 'initialise';
  const pg = new EmbeddedPostgres({ databaseDir: join(dir,'data'), port, user:'postgres', password, persistent:true, autoRehydrateSymlinks:true, postgresFlags:['-c','unix_socket_directories='], onLog:(line: string)=>diagnostics.push(line), onError:(error: unknown)=>diagnostics.push(String(error)) });
  let started = false; const stores: PostgresStore[] = [];
  try {
    await pg.initialise(); phase = 'start'; await pg.start(); started = true;
    const config = { connectionString: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`, max:5 };
    phase = 'first store initialize'; const one = new PostgresStore(config); stores.push(one); await one.initialize();
    phase = 'second store initialize'; const two = new PostgresStore(config); stores.push(two); await two.initialize();
    phase = 'initial writes'; await one.put('operations','durable',{id:'durable',amountMinor:'9007199254740993',status:'processing'});
    assert.equal((await two.get<{amountMinor:string}>('operations','durable'))?.amountMinor,'9007199254740993');
    await one.put('test_counter','counter',{value:0});
    phase = 'concurrent locks'; await Promise.all(Array.from({length:20},(_,i)=>(i%2?one:two).withLock('counter',async()=>{
      const db = i%2?one:two; const row = await db.get<{value:number}>('test_counter','counter');
      await db.put('test_counter','counter',{value:row!.value+1});
    })));
    assert.equal((await one.get<{value:number}>('test_counter','counter'))?.value,20);
    phase = 'nested locks'; await one.withLock('provider-event:x',()=>one.withLock('customer:x',()=>one.put('events','x',{done:true})));
    await assert.rejects(one.withLock('failure',async()=>{throw new Error('fail');}));
    await two.withLock('failure',async()=>{});

    phase = 'idle connection loss';
    const warning = t.mock.method(console, 'warn', () => {});
    const idlePid = (await one.pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const idleFailure = new Promise<Error>((resolve) => one.pool.once('error', resolve));
    await two.pool.query('SELECT pg_terminate_backend($1)', [idlePid]);
    assert.match((await idleFailure).message, /administrator command/);
    assert.equal(warning.mock.calls.length, 1);
    assert.deepEqual(warning.mock.calls[0]!.arguments, ['PostgreSQL idle connection closed; the next request will reconnect.']);
    warning.mock.restore();
    await one.health();

    phase = 'locked connection loss';
    let enter!: () => void; let continueWork!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const resume = new Promise<void>((resolve) => { continueWork = resolve; });
    const held = one.withLock('connection-loss', async () => {
      enter(); await resume;
      await one.put('events', 'must-not-save', { done: true });
    });
    const rejected = assert.rejects(held);
    await entered;
    const locked = await two.pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())");
    assert.equal(locked.rows.length, 1);
    await two.pool.query('SELECT pg_terminate_backend($1)', [locked.rows[0].pid]);
    continueWork(); await rejected;
    await two.withLock('connection-loss', async () => {});
    assert.equal(await two.get('events', 'must-not-save'), undefined);

    phase = 'close connections'; await Promise.all(stores.splice(0).map(s=>s.close()));
    phase = 'stop server'; await pg.stop(); started=false; phase = 'restart server'; await pg.start(); started=true;
    phase = 'read after restart'; const restarted = new PostgresStore(config); stores.push(restarted);
    assert.equal((await restarted.get<{status:string}>('operations','durable'))?.status,'processing');
    await assert.rejects(restarted.get('injected;DROP TABLE','x'));
  } catch (error) {
    t.diagnostic(`PostgreSQL phase: ${phase}\n${diagnostics.join('').slice(-6000)}`);
    throw error;
  } finally {
    await Promise.all(stores.map(s=>s.close()));
    if(started) await pg.stop();
    await rm(dir,{recursive:true,force:true});
  }
});
