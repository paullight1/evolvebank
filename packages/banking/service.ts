import { createHash, randomUUID } from 'node:crypto';
import {
  account, type Currency, type Customer, type Ledger, type Operation,
  type Posting, type ProviderEvent, type Quote, type Reconciliation, type Store, type Wallet,
} from './contracts.js';
import { BankingError } from './errors.js';
import { DEMO_NGN_PER_USD, MAX_MINOR, parseAmount, QUOTE_FEE_USD_MINOR, SANDBOX_USD_LIMIT } from './money.js';

/** Sandbox workflow state. Blnk remains the only runtime balance authority. */
export class BankingService {
  private readonly now: () => number;
  constructor(private readonly store: Store, private readonly ledger: Ledger, options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  async createCustomer(): Promise<Customer> {
    const customer: Customer = { id: randomUUID(), displayName: 'Sandbox customer', createdAt: this.timestamp(), sandbox: true };
    try { await this.ledger.ensureCustomer(customer.id); }
    catch { throw new BankingError(503, 'LEDGER_UNAVAILABLE', 'The sandbox ledger is unavailable. Please try again.'); }
    await this.store.put('customers', customer.id, customer);
    return customer;
  }

  async dashboard(customerId: string): Promise<{ customer: Customer; wallets: Wallet[]; operations: Operation[] }> {
    return this.store.withLock(this.customerLock(customerId), async () => {
      const customer = await this.customer(customerId);
      const wallets = await this.ledger.wallets(customerId);
      const operations = await this.operations(customerId);
      operations.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      return { customer, wallets, operations };
    });
  }

  async fund(customerId: string, amount: string, key: string): Promise<Operation> {
    const amountMinor = parseAmount(amount, SANDBOX_USD_LIMIT).toString();
    const identity = this.identity(customerId, key, { kind: 'funding', amountMinor });
    return this.store.withLock(this.customerLock(customerId), async () => {
      await this.customer(customerId);
      const existing = await this.existing(identity.id, identity.fingerprint);
      if (existing) return this.resume(existing);
      await this.assertNoUnresolved(customerId);
      const op = this.operation(customerId, key, identity, 'funding', 'USD', amountMinor);
      op.postings = [{ reference: `${op.id}-fund`, legs: [{ source: account.funding, destination: account.customer(customerId, 'USD'), currency: 'USD', amountMinor }] }];
      await this.save(op); // Durable intent must exist before a ledger effect.
      return this.resume(op);
    });
  }

  async quote(customerId: string, amount: string): Promise<Quote> {
    const amountUsdMinor = parseAmount(amount, SANDBOX_USD_LIMIT, QUOTE_FEE_USD_MINOR + 1n);
    return this.store.withLock(this.customerLock(customerId), async () => {
      await this.customer(customerId);
      const issued = this.now();
      const quote: Quote = {
        id: randomUUID(), customerId, amountUsdMinor: amountUsdMinor.toString(), feeUsdMinor: QUOTE_FEE_USD_MINOR.toString(),
        amountNgnMinor: ((amountUsdMinor - QUOTE_FEE_USD_MINOR) * DEMO_NGN_PER_USD).toString(),
        rateNgnPerUsd: '1000', createdAt: new Date(issued).toISOString(), expiresAt: new Date(issued + 120_000).toISOString(), sandbox: true,
      };
      await this.store.put('quotes', quote.id, quote);
      return quote;
    });
  }

  async exchange(customerId: string, quoteId: string, key: string): Promise<Operation> {
    if (typeof quoteId !== 'string' || quoteId.length > 100 || quoteId.length === 0) {
      throw new BankingError(400, 'INVALID_QUOTE', 'Choose a valid sandbox quote.');
    }
    const identity = this.identity(customerId, key, { kind: 'exchange', quoteId });
    return this.store.withLock(this.customerLock(customerId), async () => {
      await this.customer(customerId);
      const existing = await this.existing(identity.id, identity.fingerprint);
      if (existing && this.terminal(existing)) return existing;
      const quote = await this.store.get<Quote>('quotes', quoteId);
      if (!quote || quote.customerId !== customerId) throw new BankingError(404, 'QUOTE_NOT_FOUND', 'This quote is unavailable.');
      if (quote.consumedBy && quote.consumedBy !== identity.id) throw new BankingError(409, 'QUOTE_USED', 'This quote has already been used. Request another quote.');
      if (existing) {
        // An accepted intention retains its original quote across a crash/expiry.
        // Re-persist the claim if the process stopped between the two durable writes.
        if (!quote.consumedBy) await this.store.put('quotes', quote.id, { ...quote, consumedBy: existing.id });
        return this.resume(existing);
      }
      if (this.now() >= Date.parse(quote.expiresAt)) throw new BankingError(409, 'QUOTE_EXPIRED', 'This quote has expired. Request another quote.');
      await this.assertNoUnresolved(customerId);
      await this.assertFunds(customerId, 'USD', quote.amountUsdMinor);
      const op = this.operation(customerId, key, identity, 'exchange', 'USD', quote.amountUsdMinor);
      op.quoteId = quote.id;
      op.receivedMinor = quote.amountNgnMinor;
      op.postings = [{
        reference: `${op.id}-exchange`,
        legs: [
          { source: account.customer(customerId, 'USD'), destination: account.usdTreasury, currency: 'USD', amountMinor: (BigInt(quote.amountUsdMinor) - BigInt(quote.feeUsdMinor)).toString() },
          { source: account.customer(customerId, 'USD'), destination: account.fees, currency: 'USD', amountMinor: quote.feeUsdMinor },
          { source: account.ngnTreasury, destination: account.customer(customerId, 'NGN'), currency: 'NGN', amountMinor: quote.amountNgnMinor },
        ],
      }];
      await this.save(op);
      await this.store.put('quotes', quote.id, { ...quote, consumedBy: op.id });
      return this.resume(op);
    });
  }

  async payout(customerId: string, amount: string, beneficiary: string, key: string): Promise<Operation> {
    const amountMinor = parseAmount(amount).toString();
    const name = this.beneficiary(beneficiary);
    const identity = this.identity(customerId, key, { kind: 'payout', amountMinor, beneficiary: name });
    return this.store.withLock(this.customerLock(customerId), async () => {
      await this.customer(customerId);
      const existing = await this.existing(identity.id, identity.fingerprint);
      if (existing) return this.resume(existing);
      await this.assertNoUnresolved(customerId);
      await this.assertFunds(customerId, 'NGN', amountMinor);
      const op = this.operation(customerId, key, identity, 'payout', 'NGN', amountMinor);
      op.beneficiary = name;
      op.postings = [{ reference: `${op.id}-reserve`, legs: [{ source: account.customer(customerId, 'NGN'), destination: account.hold(customerId), currency: 'NGN', amountMinor }] }];
      await this.save(op);
      return this.resume(op);
    });
  }

  async settle(input: ProviderEvent): Promise<Operation> {
    const event = this.providerEvent(input);
    // The global event lock always precedes the customer lock. No other method
    // acquires an event lock, so distinct event IDs cannot create a lock cycle.
    return this.store.withLock(`provider-event:${event.id}`, () => this.store.withLock(this.customerLock(event.customerId), async () => {
      const priorEvent = await this.store.get<ProviderEvent>('provider_events', event.id);
      if (priorEvent && this.hash(priorEvent) !== this.hash(event)) {
        throw new BankingError(409, 'PROVIDER_EVENT_CONFLICT', 'This provider event ID was already used with different details.');
      }
      await this.customer(event.customerId);
      const op = await this.store.get<Operation>('operations', event.operationId);
      if (!op || op.customerId !== event.customerId || op.kind !== 'payout') throw new BankingError(404, 'PAYOUT_NOT_FOUND', 'This payout is unavailable.');
      if (op.amountMinor !== event.amountMinor || op.currency !== event.currency) {
        throw new BankingError(409, 'PROVIDER_EVENT_MISMATCH', 'Provider confirmation does not match the reserved amount and currency.');
      }
      const acceptedEvents = (await this.store.list<ProviderEvent>('provider_events')).filter((e) => e.customerId === op.customerId && e.operationId === op.id);
      if (acceptedEvents.some((e) => e.outcome !== event.outcome)) {
        // The provider event is itself a durable decision, including the crash
        // window before the operation's outcome field has been written.
        throw new BankingError(409, 'PAYOUT_OUTCOME_CONFLICT', 'A different provider outcome has already been recorded for this payout.');
      }
      if (op.outcome && op.outcome !== event.outcome) throw new BankingError(409, 'PAYOUT_OUTCOME_CONFLICT', 'This payout already has a different final outcome.');
      if (!op.outcome && op.status !== 'pending') throw new BankingError(409, 'PAYOUT_NOT_READY', 'The payout reservation must be confirmed before settlement.');
      if (!priorEvent) await this.store.put('provider_events', event.id, event);
      if (this.terminal(op)) return op;

      op.outcome = event.outcome;
      const settlement: Posting = {
        reference: `${op.id}-settle`,
        legs: [{ source: account.hold(op.customerId), destination: event.outcome === 'succeeded' ? account.paid : account.customer(op.customerId, 'NGN'), currency: 'NGN', amountMinor: op.amountMinor }],
      };
      const priorPosting = op.postings.find((p) => p.reference === settlement.reference);
      if (priorPosting && this.hash(priorPosting) !== this.hash(settlement)) throw new BankingError(409, 'PAYOUT_OUTCOME_CONFLICT', 'The recorded settlement differs from the provider event.');
      if (!priorPosting) op.postings.push(settlement);
      op.status = 'processing';
      await this.save(op); // The chosen outcome is immutable before moving the hold.
      return this.resume(op);
    }));
  }

  async reconciliation(customerId: string): Promise<Reconciliation> {
    return this.store.withLock(this.customerLock(customerId), async () => {
      await this.customer(customerId);
      const operations = await this.operations(customerId);
      const statements = (await this.store.list<ProviderEvent>('provider_events')).filter((e) => e.customerId === customerId);
      const report: Reconciliation = { ok: true, checkedAt: this.timestamp(), checkedOperations: operations.length, pendingOperations: 0, issues: [] };
      const expected = new Map<string, bigint>([
        [account.customer(customerId, 'USD'), 0n], [account.customer(customerId, 'NGN'), 0n], [account.hold(customerId), 0n],
      ]);
      const issue = (operationId: string, message: string) => { report.issues.push({ operationId, message }); };

      for (const op of operations) {
        if (!this.terminal(op)) report.pendingOperations++;
        if (op.status === 'processing' || op.status === 'review') issue(op.id, 'This operation has an unresolved ledger outcome. Retry the original request to recover it.');
        const expectedPostingCount = op.kind === 'payout' && op.outcome ? 2 : 1;
        if (op.postings.length !== expectedPostingCount) issue(op.id, 'The stored operation is missing expected posting instructions.');
        for (const posting of op.postings) {
          try {
            const result = await this.ledger.verify(posting.reference, posting.legs);
            if (!result.ok) {
              for (const detail of result.issues.length ? result.issues : ['Ledger posting could not be verified.']) issue(op.id, detail);
              continue;
            }
            for (const leg of posting.legs) {
              const amount = BigInt(leg.amountMinor);
              if (expected.has(leg.source)) expected.set(leg.source, expected.get(leg.source)! - amount);
              if (expected.has(leg.destination)) expected.set(leg.destination, expected.get(leg.destination)! + amount);
            }
          } catch { issue(op.id, 'The ledger could not verify this posting.'); }
        }
        if (op.kind === 'payout') {
          const events = statements.filter((e) => e.operationId === op.id);
          if (op.outcome && !events.some((e) => e.outcome === op.outcome && e.amountMinor === op.amountMinor && e.currency === op.currency)) issue(op.id, 'A matching simulated provider statement is missing.');
          if (events.some((e) => e.amountMinor !== op.amountMinor || e.currency !== op.currency || (op.outcome && e.outcome !== op.outcome))) issue(op.id, 'A simulated provider statement conflicts with the payout.');
          if (!op.outcome && events.length > 0) issue(op.id, 'A provider event was recorded but its settlement still needs recovery.');
          if (this.terminal(op) && op.status !== (op.outcome === 'succeeded' ? 'completed' : 'failed')) issue(op.id, 'The final payout state conflicts with the provider outcome.');
        }
      }
      for (const statement of statements) if (!operations.some((op) => op.id === statement.operationId && op.kind === 'payout')) issue(statement.operationId, 'A simulated provider statement has no matching payout.');

      try {
        const wallets = await this.ledger.wallets(customerId);
        for (const currency of ['USD', 'NGN'] as const) {
          const matches = wallets.filter((w) => w.currency === currency);
          const wallet = matches[0];
          const held = currency === 'NGN' ? expected.get(account.hold(customerId))! : 0n;
          if (matches.length !== 1 || !wallet || wallet.availableMinor !== expected.get(account.customer(customerId, currency))!.toString() || wallet.heldMinor !== held.toString()) {
            issue('balances', `${currency} ledger balance differs from verified operation postings.`);
          }
        }
      } catch { issue('balances', 'Ledger balances are unavailable for reconciliation.'); }
      report.ok = report.issues.length === 0;
      await this.store.put('reconciliations', customerId, report);
      return report;
    });
  }

  private async resume(op: Operation): Promise<Operation> {
    if (this.terminal(op) || op.status === 'pending') return op;
    try {
      for (const posting of op.postings) {
        await this.ledger.post(posting.reference, posting.legs);
        const verified = await this.ledger.verify(posting.reference, posting.legs);
        if (!verified.ok) throw new Error('Ledger posting has no verified final result');
      }
      op.status = op.kind === 'payout' ? (op.outcome === 'succeeded' ? 'completed' : op.outcome === 'failed' ? 'failed' : 'pending') : 'completed';
      delete op.error;
      await this.save(op);
      return op;
    } catch {
      op.status = 'review';
      op.error = 'Ledger confirmation is unavailable. Retry the original request; do not create a replacement transfer.';
      await this.save(op);
      throw new BankingError(503, 'LEDGER_UNAVAILABLE', op.error);
    }
  }

  private async customer(id: string): Promise<Customer> {
    const customer = typeof id === 'string' && id.length <= 100 ? await this.store.get<Customer>('customers', id) : undefined;
    if (!customer) throw new BankingError(404, 'CUSTOMER_NOT_FOUND', 'Start a sandbox session to continue.');
    return customer;
  }
  private async operations(customerId: string): Promise<Operation[]> {
    return (await this.store.list<Operation>('operations')).filter((op) => op.customerId === customerId);
  }
  private async assertNoUnresolved(customerId: string): Promise<void> {
    if ((await this.operations(customerId)).some((op) => op.status === 'processing' || op.status === 'review')) {
      throw new BankingError(409, 'OPERATION_REQUIRES_REVIEW', 'Recover the unresolved operation with its original request before starting another transfer.');
    }
    const reconciliation = await this.store.get<Reconciliation>('reconciliations', customerId);
    if (reconciliation && !reconciliation.ok) throw new BankingError(409, 'RECONCILIATION_REQUIRED', 'Resolve the detected ledger discrepancy and run a clean reconciliation before starting another transfer.');
  }
  private async assertFunds(customerId: string, currency: Currency, amountMinor: string): Promise<void> {
    const wallet = (await this.ledger.wallets(customerId)).find((w) => w.currency === currency);
    if (!wallet || BigInt(wallet.availableMinor) < BigInt(amountMinor)) throw new BankingError(409, 'INSUFFICIENT_FUNDS', `Your available ${currency} sandbox balance is too low.`);
  }
  private async existing(id: string, fingerprint: string): Promise<Operation | undefined> {
    const existing = await this.store.get<Operation>('operations', id);
    if (existing && existing.fingerprint !== fingerprint) throw new BankingError(409, 'IDEMPOTENCY_CONFLICT', 'This request key was already used with different details.');
    return existing;
  }
  private identity(customerId: string, key: string, payload: object): { id: string; fingerprint: string } {
    if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) throw new BankingError(400, 'INVALID_IDEMPOTENCY_KEY', 'Provide an 8–128 character idempotency key for this request.');
    return { id: `op_${this.hash([customerId, key]).slice(0,40)}`, fingerprint: this.hash(payload) };
  }
  private operation(customerId: string, key: string, identity: { id: string; fingerprint: string }, kind: Operation['kind'], currency: Currency, amountMinor: string): Operation {
    const timestamp = this.timestamp();
    return { ...identity, customerId, kind, currency, amountMinor, idempotencyKey: key, status: 'processing', createdAt: timestamp, updatedAt: timestamp, postings: [], sandbox: true };
  }
  private beneficiary(value: string): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value)) throw new BankingError(400, 'INVALID_BENEFICIARY', 'Enter a sandbox recipient label of 1–80 characters.');
    return value.trim();
  }
  private providerEvent(input: ProviderEvent): ProviderEvent {
    if (!input || typeof input !== 'object' || !['succeeded', 'failed'].includes(input.outcome) || input.currency !== 'NGN' ||
      typeof input.amountMinor !== 'string' || !/^[1-9]\d{0,8}$/.test(input.amountMinor) || BigInt(input.amountMinor) > MAX_MINOR ||
      typeof input.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.id) ||
      typeof input.customerId !== 'string' || input.customerId.length > 100 || !input.customerId ||
      typeof input.operationId !== 'string' || input.operationId.length > 100 || !input.operationId ||
      typeof input.createdAt !== 'string' || !Number.isFinite(Date.parse(input.createdAt))) {
      throw new BankingError(400, 'INVALID_PROVIDER_EVENT', 'Invalid simulated provider event.');
    }
    // Canonical field order makes event dedup independent of JSON property order.
    return { id: input.id, customerId: input.customerId, operationId: input.operationId, outcome: input.outcome, amountMinor: input.amountMinor, currency: 'NGN', createdAt: input.createdAt };
  }
  private terminal(op: Operation): boolean { return op.status === 'completed' || op.status === 'failed'; }
  private async save(op: Operation): Promise<void> { op.updatedAt = this.timestamp(); await this.store.put('operations', op.id, op); }
  private timestamp(): string { return new Date(this.now()).toISOString(); }
  private customerLock(id: string): string { return `customer:${id}`; }
  private hash(value: unknown): string {
    // JSONB may return object properties in a different order. Hash semantics,
    // preserving array order while sorting every object's keys recursively.
    const canonical = JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
    return createHash('sha256').update(canonical).digest('hex');
  }
}
