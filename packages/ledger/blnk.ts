import { createHash } from 'node:crypto';
import { account, type Currency, type Ledger, type LedgerLeg, type Store, type Wallet } from '../banking/contracts.js';

/** Adapter for the Blnk source pinned in upstreams.lock.json. No runtime memory ledger. */
export class LedgerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}

class HttpError extends LedgerError {
  readonly status: number;
  readonly remoteCode: string;
  constructor(status: number, remoteCode: string) {
    // Never expose an upstream body, URL, request headers, or fetch error text.
    super('LEDGER_UNAVAILABLE', 'The ledger request could not be completed.');
    this.status = status;
    this.remoteCode = remoteCode;
  }
}

type Json = Record<string, unknown>;
type AccountRecord = { id: string; currency: Currency; ledgerId: string; balanceId?: string; creationStarted?: boolean };
type LedgerConfig = { id: string; ledgerId?: string; creationStarted?: boolean };
type ResolvedLeg = LedgerLeg & { sourceId: string; destinationId: string; reference: string; allowOverdraft: boolean };
type Manifest = { id: string; fingerprint: string; state: 'submitted' | 'applied' | 'review'; legs: ResolvedLeg[] };

const LEDGER_NAME = 'Evolve sandbox v1';
const CONFIG_KEY = 'sandbox-v1';
const NGN_FUNDING = 'system:NGN:funding';
const SEED_REFERENCE = 'evolve:seed:NGN:v1';
// Fictitious liquidity, once per Blnk ledger. This is deliberately bounded.
const SEED_NGN_MINOR = '100000000000'; // NGN 1,000,000,000.00
const MAX_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER);
const SYSTEM_ACCOUNTS: Array<[string, Currency]> = [
  [account.funding, 'USD'], [account.usdTreasury, 'USD'], [account.fees, 'USD'],
  [NGN_FUNDING, 'NGN'], [account.ngnTreasury, 'NGN'], [account.paid, 'NGN'],
];

function postingFingerprint(legs: ResolvedLeg[]): string {
  // JSONB changes object key order. Hash an explicit semantic tuple per leg,
  // preserving the meaningful leg order but never the caller's property order.
  const canonical = legs.map(leg => [
    leg.source, leg.destination, leg.currency, leg.amountMinor,
    leg.sourceId, leg.destinationId, leg.reference, leg.allowOverdraft,
  ]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function fail(code: string, message: string): never { throw new LedgerError(code, message); }
function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('LEDGER_PROTOCOL', 'The ledger returned an invalid response.');
  return value as Json;
}
function stringField(row: Json, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || !value) return fail('LEDGER_PROTOCOL', 'The ledger returned an invalid identifier.');
  return value;
}
function minor(value: unknown, nonnegative = true): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return fail('LEDGER_PROTOCOL', 'The ledger returned an unsafe monetary value.');
    value = String(value);
  }
  if (typeof value !== 'string' || !/^-?(0|[1-9]\d*)$/.test(value)) return fail('LEDGER_PROTOCOL', 'The ledger returned an invalid monetary value.');
  const result = BigInt(value);
  if (nonnegative && result < 0n) return fail('LEDGER_PROTOCOL', 'The ledger returned a negative customer balance.');
  return result;
}

/** Preserve Blnk big.Int JSON integers before JSON.parse can round them. */
function parseJson(text: string): unknown {
  let result = '';
  for (let i = 0; i < text.length;) {
    if (text[i] === '"') {
      const start = i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i++] === '"') break;
      }
      result += text.slice(start, i);
    } else if (text[i] === '-' || /\d/.test(text[i] ?? '')) {
      const token = text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)?.[0];
      if (!token) return fail('LEDGER_PROTOCOL', 'The ledger returned invalid JSON.');
      result += /^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token)) ? JSON.stringify(token) : token;
      i += token.length;
    } else result += text[i++];
  }
  try { return JSON.parse(result); } catch { return fail('LEDGER_PROTOCOL', 'The ledger returned invalid JSON.'); }
}

export class BlnkLedger implements Ledger {
  private readonly store: Store;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(store: Store, options: { baseUrl: string; apiKey: string; fetch?: typeof globalThis.fetch }) {
    let url: URL;
    try { url = new URL(options.baseUrl); } catch { fail('LEDGER_CONFIG', 'A valid ledger URL is required.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !options.apiKey) {
      fail('LEDGER_CONFIG', 'A ledger URL and private API key are required.');
    }
    this.store = store;
    this.baseUrl = url.toString().replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method, headers: { 'X-Blnk-Key': this.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
    } catch { return fail('LEDGER_UNAVAILABLE', 'The ledger is temporarily unavailable.'); }
    let text: string;
    try { text = await response.text(); } catch { return fail('LEDGER_UNAVAILABLE', 'The ledger response could not be read.'); }
    if (text.length > 1_000_000) return fail('LEDGER_PROTOCOL', 'The ledger response is too large.');
    let parsed: unknown;
    try { parsed = parseJson(text); } catch {
      if (!response.ok) throw new HttpError(response.status, '');
      return fail('LEDGER_PROTOCOL', 'The ledger returned invalid JSON.');
    }
    if (!response.ok) {
      const detail = typeof parsed === 'object' && parsed !== null ? (parsed as Json).error_detail : undefined;
      const code = typeof detail === 'object' && detail !== null ? (detail as Json).code : '';
      throw new HttpError(response.status, typeof code === 'string' && /^[A-Z_]{1,80}$/.test(code) ? code : '');
    }
    return parsed;
  }

  private async transaction(reference: string): Promise<Json | undefined> {
    try { return object(await this.request('GET', `/transactions/reference/${encodeURIComponent(reference)}`)); }
    catch (error) {
      if (error instanceof HttpError && error.status === 404 && error.remoteCode === 'TXN_NOT_FOUND') return undefined;
      throw error;
    }
  }

  private async filter(path: string, filters: Array<{ field: string; operator: string; value: string }>): Promise<Json[]> {
    const found = await this.request('POST', path, { filters, limit: 2, offset: 0 });
    // The pinned balance filter serializes an empty Go slice as JSON null.
    if (found === null) return [];
    if (!Array.isArray(found)) return fail('LEDGER_PROTOCOL', 'The ledger returned an invalid lookup response.');
    return found.map(object);
  }

  private async ensureLedger(): Promise<string> {
    const saved = await this.store.get<LedgerConfig>('ledger_config', CONFIG_KEY);
    if (saved?.ledgerId) return saved.ledgerId;
    const lookup = () => this.filter('/ledgers/filter', [{ field: 'name', operator: 'eq', value: LEDGER_NAME }]);
    let rows = await lookup();
    if (rows.length === 0) {
      if (saved?.creationStarted) return fail('LEDGER_INDETERMINATE', 'Ledger creation needs reconciliation before another attempt.');
      await this.store.put('ledger_config', CONFIG_KEY, { id: CONFIG_KEY, creationStarted: true });
      try { rows = [object(await this.request('POST', '/ledgers', { name: LEDGER_NAME, meta_data: { application: 'evolve', sandbox: true } }))]; }
      catch (error) { rows = await lookup(); if (rows.length === 0) throw error; }
    }
    if (rows.length !== 1 || rows[0]!.name !== LEDGER_NAME) return fail('LEDGER_CONFLICT', 'The sandbox ledger could not be uniquely identified.');
    const ledgerId = stringField(rows[0]!, 'ledger_id');
    await this.store.put('ledger_config', CONFIG_KEY, { id: CONFIG_KEY, ledgerId });
    return ledgerId;
  }

  private async ensureAccount(id: string, currency: Currency, ledgerId: string): Promise<void> {
    const saved = await this.store.get<AccountRecord>('ledger_accounts', id);
    if (saved?.balanceId) {
      if (saved.currency !== currency || saved.ledgerId !== ledgerId) return fail('LEDGER_CONFLICT', 'A ledger account mapping conflicts with this operation.');
      return;
    }
    // Metadata survives a response loss between Blnk creation and the local ID save.
    const lookup = () => this.filter('/balances/filter', [
      { field: 'ledger_id', operator: 'eq', value: ledgerId },
      { field: 'currency', operator: 'eq', value: currency },
      { field: 'meta_data.evolve_account', operator: 'eq', value: id },
    ]);
    let rows = await lookup();
    if (rows.length === 0) {
      if (saved?.creationStarted) return fail('LEDGER_INDETERMINATE', 'Account creation needs reconciliation before another attempt.');
      await this.store.put('ledger_accounts', id, { id, currency, ledgerId, creationStarted: true });
      try {
        rows = [object(await this.request('POST', '/balances', {
          ledger_id: ledgerId, currency, meta_data: { evolve_account: id, sandbox: true },
        }))];
      } catch (error) { rows = await lookup(); if (rows.length === 0) throw error; }
    }
    if (rows.length !== 1 || rows[0]!.currency !== currency || rows[0]!.ledger_id !== ledgerId || object(rows[0]!.meta_data).evolve_account !== id) {
      return fail('LEDGER_CONFLICT', 'A ledger account could not be uniquely identified.');
    }
    await this.store.put('ledger_accounts', id, { id, currency, ledgerId, balanceId: stringField(rows[0]!, 'balance_id') });
  }

  async ensureCustomer(customerId: string): Promise<void> {
    if (typeof customerId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(customerId)) return fail('LEDGER_INVALID_INPUT', 'A valid sandbox customer is required.');
    await this.store.withLock('blnk:setup', async () => {
      const ledgerId = await this.ensureLedger();
      for (const [id, currency] of SYSTEM_ACCOUNTS) await this.ensureAccount(id, currency, ledgerId);
      await this.post(SEED_REFERENCE, [{ source: NGN_FUNDING, destination: account.ngnTreasury, currency: 'NGN', amountMinor: SEED_NGN_MINOR }]);
      await this.ensureAccount(account.customer(customerId, 'USD'), 'USD', ledgerId);
      await this.ensureAccount(account.customer(customerId, 'NGN'), 'NGN', ledgerId);
      await this.ensureAccount(account.hold(customerId), 'NGN', ledgerId);
    });
  }

  private validate(reference: string, legs: LedgerLeg[]): void {
    if (typeof reference !== 'string' || !/^[a-zA-Z0-9:_-]{1,180}$/.test(reference) || !Array.isArray(legs) || legs.length < 1 || legs.length > 16) {
      return fail('LEDGER_INVALID_INPUT', 'A valid posting reference and ledger legs are required.');
    }
    for (const leg of legs) {
      if (!leg || !['USD', 'NGN'].includes(leg.currency) || typeof leg.source !== 'string' || typeof leg.destination !== 'string' || leg.source === leg.destination ||
          typeof leg.amountMinor !== 'string' || !/^[1-9]\d{0,15}$/.test(leg.amountMinor) || BigInt(leg.amountMinor) > MAX_AMOUNT) {
        return fail('LEDGER_INVALID_INPUT', 'Postings require positive safe integer minor amounts and distinct accounts.');
      }
      if (leg.source === NGN_FUNDING && (reference !== SEED_REFERENCE || leg.destination !== account.ngnTreasury || leg.amountMinor !== SEED_NGN_MINOR || legs.length !== 1)) {
        return fail('LEDGER_INVALID_INPUT', 'Sandbox treasury funding is restricted to its one bootstrap posting.');
      }
      if (leg.source === account.funding && (leg.currency !== 'USD' || !/^customer:[a-zA-Z0-9_-]{1,100}:USD$/.test(leg.destination) || legs.length !== 1)) {
        return fail('LEDGER_INVALID_INPUT', 'Sandbox external funding must credit one customer USD account.');
      }
    }
  }

  private async resolve(reference: string, legs: LedgerLeg[]): Promise<ResolvedLeg[]> {
    this.validate(reference, legs);
    return Promise.all(legs.map(async (leg, index) => {
      const [source, destination] = await Promise.all([
        this.store.get<AccountRecord>('ledger_accounts', leg.source), this.store.get<AccountRecord>('ledger_accounts', leg.destination),
      ]);
      if (!source?.balanceId || !destination?.balanceId || source.currency !== leg.currency || destination.currency !== leg.currency || source.ledgerId !== destination.ledgerId) {
        return fail('LEDGER_CONFLICT', 'The posting does not match initialized currency accounts.');
      }
      return { ...leg, sourceId: source.balanceId, destinationId: destination.balanceId, reference: `${reference}:${index}`,
        allowOverdraft: leg.source === account.funding || leg.source === NGN_FUNDING };
    }));
  }

  private async inspect(legs: ResolvedLeg[]): Promise<{ present: number; issues: string[] }> {
    let present = 0;
    const issues: string[] = [];
    for (let index = 0; index < legs.length; index++) {
      const leg = legs[index]!;
      const lookup = await this.transaction(leg.reference);
      if (!lookup) { issues.push(`Ledger leg ${index + 1} is missing.`); continue; }
      present++;
      // The pinned by-reference SQL omits precision. Resolve the ID then read
      // the complete row; do not infer monetary scale from its displayed amount.
      const txId = stringField(lookup, 'transaction_id');
      const actual = object(await this.request('GET', `/transactions/${encodeURIComponent(txId)}`));
      const metadata = actual.meta_data && typeof actual.meta_data === 'object' ? actual.meta_data as Json : {};
      // Blnk persists allow_overdraft in metadata; fetched top-level bool defaults false.
      const allowOverdraft = actual.allow_overdraft === true || metadata.allow_overdraft === true;
      if (actual.transaction_id !== txId || actual.reference !== leg.reference || actual.source !== leg.sourceId || actual.destination !== leg.destinationId || actual.currency !== leg.currency ||
          minor(actual.precise_amount) !== BigInt(leg.amountMinor) || actual.precision !== 100 || allowOverdraft !== leg.allowOverdraft) {
        issues.push(`Ledger leg ${index + 1} conflicts with the recorded intention.`);
      }
      if (actual.status !== 'APPLIED' || actual.inflight !== false) issues.push(`Ledger leg ${index + 1} is not applied.`);
      // Atomic rollback leaves original APPLIED rows intact and appends refunds.
      // A reference-only status check would otherwise misreport a reversed FX as complete.
      const reversal = await this.transaction(`${txId}_refund`);
      const queuedReversal = reversal ? undefined : await this.transaction(`${txId}_refund_q`);
      if (reversal || queuedReversal) issues.push(`Ledger leg ${index + 1} has a reversal or pending reversal.`);
    }
    return { present, issues };
  }

  async post(reference: string, legs: LedgerLeg[]): Promise<void> {
    this.validate(reference, legs);
    await this.store.withLock(`blnk:post:${createHash('sha256').update(reference).digest('hex')}`, async () => {
      const resolved = await this.resolve(reference, legs);
      const fingerprint = postingFingerprint(resolved);
      const existing = await this.store.get<Manifest>('ledger_postings', reference);
      if (existing && existing.fingerprint !== fingerprint) return fail('LEDGER_CONFLICT', 'This posting reference was already used for different ledger legs.');
      const before = await this.inspect(resolved);
      if (!existing && await this.transaction(`${reference}:${resolved.length}`)) return fail('LEDGER_CONFLICT', 'This posting reference belongs to a different ledger batch.');
      if (before.issues.length === 0) {
        await this.store.put('ledger_postings', reference, { id: reference, fingerprint, state: 'applied', legs: resolved });
        return;
      }
      if (before.present > 0 || existing) return fail('LEDGER_INDETERMINATE', 'This posting is partial or uncertain and needs reconciliation.');
      const manifest: Manifest = { id: reference, fingerprint, state: 'submitted', legs: resolved };
      // Durable before the HTTP side effect. A lost response never authorizes a fresh batch.
      await this.store.put('ledger_postings', reference, manifest);
      const transactions = resolved.map(leg => ({
        source: leg.sourceId, destination: leg.destinationId, currency: leg.currency, precise_amount: Number(leg.amountMinor),
        precision: 100, reference: leg.reference, allow_overdraft: leg.allowOverdraft, inflight: false, skip_queue: true,
        description: 'Evolve sandbox simulated funds', meta_data: { evolve_reference: reference, sandbox: true },
      }));
      let requestError: unknown;
      try {
        if (transactions.length === 1) await this.request('POST', '/transactions', transactions[0]);
        else await this.request('POST', '/transactions/bulk', { atomic: true, inflight: false, skip_queue: true, run_async: false, transactions });
      } catch (error) { requestError = error; }
      let after: { present: number; issues: string[] };
      try { after = await this.inspect(resolved); }
      catch {
        await this.store.put('ledger_postings', reference, { ...manifest, state: 'review' });
        return fail('LEDGER_INDETERMINATE', 'The posting outcome is unknown and needs reconciliation.');
      }
      if (after.issues.length === 0) {
        await this.store.put('ledger_postings', reference, { ...manifest, state: 'applied' });
        return;
      }
      await this.store.put('ledger_postings', reference, { ...manifest, state: 'review' });
      if (after.present === 0 && requestError instanceof HttpError && requestError.remoteCode === 'TXN_INSUFFICIENT_FUNDS') {
        return fail('LEDGER_REJECTED', 'The ledger rejected this posting because funds are insufficient.');
      }
      return fail('LEDGER_INDETERMINATE', 'The posting was not fully confirmed and needs reconciliation.');
    });
  }

  async verify(reference: string, legs: LedgerLeg[]): Promise<{ ok: boolean; issues: string[] }> {
    try {
      const resolved = await this.resolve(reference, legs);
      const manifest = await this.store.get<Manifest>('ledger_postings', reference);
      const fingerprint = postingFingerprint(resolved);
      if (manifest && manifest.fingerprint !== fingerprint) return { ok: false, issues: ['Ledger posting intention does not match its persisted manifest.'] };
      const result = await this.inspect(resolved);
      return { ok: result.issues.length === 0, issues: result.issues };
    } catch { return { ok: false, issues: ['Ledger verification is unavailable or the posting is invalid.'] }; }
  }

  private async balance(id: string, currency: Currency): Promise<bigint> {
    const saved = await this.store.get<AccountRecord>('ledger_accounts', id);
    if (!saved?.balanceId || saved.currency !== currency) return fail('LEDGER_CONFLICT', 'The customer balance has not been initialized.');
    const row = object(await this.request('GET', `/balances/${encodeURIComponent(saved.balanceId)}`));
    if (row.balance_id !== saved.balanceId || row.currency !== currency || row.ledger_id !== saved.ledgerId) return fail('LEDGER_CONFLICT', 'The ledger returned a different customer account.');
    const available = minor(row.balance) - minor(row.inflight_debit_balance);
    if (available < 0n) return fail('LEDGER_PROTOCOL', 'The ledger reported an invalid available balance.');
    return available;
  }

  async wallets(customerId: string): Promise<Wallet[]> {
    const [usd, ngn, held] = await Promise.all([
      this.balance(account.customer(customerId, 'USD'), 'USD'), this.balance(account.customer(customerId, 'NGN'), 'NGN'), this.balance(account.hold(customerId), 'NGN'),
    ]);
    return [
      { currency: 'USD', availableMinor: usd.toString(), heldMinor: '0' },
      { currency: 'NGN', availableMinor: ngn.toString(), heldMinor: held.toString() },
    ];
  }

  async health(): Promise<void> {
    const response = object(await this.request('GET', '/health'));
    if (response.status !== 'UP') return fail('LEDGER_UNAVAILABLE', 'The ledger is not healthy.');
  }
}
