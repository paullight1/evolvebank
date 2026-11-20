import { account, type Ledger, type LedgerLeg, type Store, type Wallet } from '../../packages/banking/contracts.js';

/** Test doubles only. Runtime wiring must use PostgreSQL and Blnk. */
export class MemoryStore implements Store {
  readonly documents = new Map<string, unknown>();
  private readonly locks = new Map<string, Promise<void>>();

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    return structuredClone(this.documents.get(`${collection}/${id}`)) as T | undefined;
  }
  async put<T>(collection: string, id: string, value: T): Promise<void> {
    this.documents.set(`${collection}/${id}`, structuredClone(value));
  }
  async list<T>(collection: string): Promise<T[]> {
    return [...this.documents].filter(([key]) => key.startsWith(`${collection}/`)).map(([, value]) => structuredClone(value) as T);
  }
  async withLock<T>(scope: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(scope) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(scope, current);
    await previous;
    try { return await work(); }
    finally { release(); if (this.locks.get(scope) === current) this.locks.delete(scope); }
  }
}

export class MemoryLedger implements Ledger {
  readonly amounts = new Map<string, bigint>([[account.ngnTreasury, 1_000_000_000_000n]]);
  readonly postings = new Map<string, LedgerLeg[]>();
  loseNextResponse = false;
  unavailable = false;

  async health(): Promise<void> { if (this.unavailable) throw new Error('Ledger unavailable'); }
  async ensureCustomer(customerId: string): Promise<void> {
    await this.health();
    for (const key of [account.customer(customerId, 'USD'), account.customer(customerId, 'NGN'), account.hold(customerId)]) {
      if (!this.amounts.has(key)) this.amounts.set(key, 0n);
    }
  }
  async post(reference: string, legs: LedgerLeg[]): Promise<void> {
    await this.health();
    const prior = this.postings.get(reference);
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(legs)) throw new Error('Ledger reference conflict');
      return;
    }
    const staged = new Map(this.amounts);
    for (const leg of legs) {
      const value = BigInt(leg.amountMinor);
      if (value <= 0n) throw new Error('Invalid ledger amount');
      const balance = staged.get(leg.source) ?? 0n;
      if (leg.source !== account.funding && balance < value) throw new Error('Insufficient ledger funds');
      staged.set(leg.source, balance - value);
      staged.set(leg.destination, (staged.get(leg.destination) ?? 0n) + value);
    }
    this.amounts.clear();
    for (const [key, value] of staged) this.amounts.set(key, value);
    this.postings.set(reference, structuredClone(legs));
    if (this.loseNextResponse) { this.loseNextResponse = false; throw new Error('Response lost after ledger commit'); }
  }
  async wallets(customerId: string): Promise<Wallet[]> {
    await this.health();
    return [
      { currency: 'USD', availableMinor: (this.amounts.get(account.customer(customerId, 'USD')) ?? 0n).toString(), heldMinor: '0' },
      { currency: 'NGN', availableMinor: (this.amounts.get(account.customer(customerId, 'NGN')) ?? 0n).toString(), heldMinor: (this.amounts.get(account.hold(customerId)) ?? 0n).toString() },
    ];
  }
  async verify(reference: string, legs: LedgerLeg[]): Promise<{ ok: boolean; issues: string[] }> {
    await this.health();
    const ok = JSON.stringify(this.postings.get(reference)) === JSON.stringify(legs);
    return { ok, issues: ok ? [] : [`Posting ${reference} is missing or differs from the intended transfer.`] };
  }
}
