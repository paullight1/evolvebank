import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type { Store } from '../banking/contracts.js';

/** Durable workflow metadata only. Customer balances live exclusively in Blnk. */
export class PostgresStore implements Store {
  readonly pool: Pool;
  private readonly context = new AsyncLocalStorage<PoolClient>();
  private readonly connections = new Map<PoolClient, Promise<void>>();
  private shutdown?: Promise<void>;
  constructor(config: PoolConfig | Pool) {
    this.pool = config instanceof Pool ? config : new Pool(config);
    const track = (client: PoolClient) => {
      if (this.connections.has(client)) return;
      this.connections.set(client, new Promise<void>((resolve) => {
        client.once('end', () => { this.connections.delete(client); resolve(); });
      }));
    };
    this.pool.on('connect', track);
    this.pool.on('acquire', track);
    // pg removes failed idle clients itself; handling this event avoids an
    // uncaught EventEmitter error while subsequent requests obtain a new client.
    // Provider/DB error messages may contain credentials, so log fixed text only.
    this.pool.on('error', () => { console.warn('PostgreSQL idle connection closed; the next request will reconnect.'); });
  }
  async initialize(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS evolve_records (
      collection TEXT NOT NULL CHECK (length(collection) BETWEEN 1 AND 80),
      id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 250),
      data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (collection, id)
    )`);
  }
  private db(): Pool | PoolClient { return this.context.getStore() ?? this.pool; }
  private validate(collection: string, id?: string) {
    if (!/^[a-z_]{1,80}$/.test(collection) || (id !== undefined && (!id || id.length > 250))) throw new Error('Invalid storage key');
  }
  async get<T>(collection: string, id: string): Promise<T | undefined> {
    this.validate(collection, id);
    const result = await this.db().query('SELECT data FROM evolve_records WHERE collection=$1 AND id=$2', [collection, id]);
    return result.rows[0]?.data as T | undefined;
  }
  async put<T>(collection: string, id: string, value: T): Promise<void> {
    this.validate(collection, id);
    await this.db().query(`INSERT INTO evolve_records(collection,id,data) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(collection,id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, [collection, id, JSON.stringify(value)]);
  }
  async list<T>(collection: string): Promise<T[]> {
    this.validate(collection);
    const result = await this.db().query('SELECT data FROM evolve_records WHERE collection=$1 ORDER BY created_at,id', [collection]);
    return result.rows.map(row => row.data as T);
  }
  /** Session-level locks span external I/O; every intention write commits before that I/O. */
  async withLock<T>(scope: string, work: () => Promise<T>): Promise<T> {
    const inherited = this.context.getStore();
    const client = inherited ?? await this.pool.connect();
    let locked = false;
    let poisoned = false;
    let connectionFailure: Error | undefined;
    const onClientError = (error: Error) => { poisoned = true; connectionFailure = error; };
    if (!inherited) client.on('error', onClientError);
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [scope]);
      locked = true;
      const result = await this.context.run(client, work);
      if (connectionFailure) throw connectionFailure;
      return result;
    } finally {
      if (locked) {
        try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [scope]); }
        catch { poisoned = true; }
      }
      if (!inherited) { client.removeListener('error', onClientError); client.release(poisoned); }
    }
  }
  async health(): Promise<void> { await this.pool.query('SELECT 1'); }
  close(): Promise<void> {
    return this.shutdown ??= (async () => {
      await this.pool.end();
      // pg Pool.end can resolve after removing clients from its internal list
      // but before their sockets finish closing. Await actual client end events
      // before a test/container shuts down or restarts PostgreSQL.
      await Promise.all(this.connections.values());
    })();
  }
}
