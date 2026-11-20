export type Currency = 'USD' | 'NGN';
export type Minor = string;
export type Document = { id: string; [key: string]: unknown };
export interface Store {
  get<T>(collection: string, id: string): Promise<T | undefined>;
  put<T>(collection: string, id: string, value: T): Promise<void>;
  list<T>(collection: string): Promise<T[]>;
  withLock<T>(scope: string, work: () => Promise<T>): Promise<T>;
}
export interface LedgerLeg { source: string; destination: string; currency: Currency; amountMinor: Minor; }
export interface Wallet { currency: Currency; availableMinor: Minor; heldMinor: Minor; }
export interface Ledger {
  ensureCustomer(customerId: string): Promise<void>;
  post(reference: string, legs: LedgerLeg[]): Promise<void>;
  wallets(customerId: string): Promise<Wallet[]>;
  verify(reference: string, legs: LedgerLeg[]): Promise<{ ok: boolean; issues: string[] }>;
  health(): Promise<void>;
}
export const account = {
  customer: (id: string, currency: Currency) => `customer:${id}:${currency}`,
  hold: (id: string) => `customer:${id}:NGN:hold`,
  funding: 'system:USD:funding',
  usdTreasury: 'system:USD:treasury',
  fees: 'system:USD:fees',
  ngnTreasury: 'system:NGN:treasury',
  paid: 'system:NGN:paid',
} as const;
export interface Customer { id: string; displayName: string; createdAt: string; sandbox: true; }
export interface Quote {
  id: string; customerId: string; amountUsdMinor: Minor; feeUsdMinor: Minor;
  amountNgnMinor: Minor; rateNgnPerUsd: '1000'; expiresAt: string; createdAt: string;
  consumedBy?: string; sandbox: true;
}
export interface Posting { reference: string; legs: LedgerLeg[]; }
export interface Operation {
  id: string; customerId: string; kind: 'funding' | 'exchange' | 'payout';
  status: 'processing' | 'pending' | 'completed' | 'failed' | 'review';
  amountMinor: Minor; currency: Currency; createdAt: string; updatedAt: string;
  fingerprint: string; idempotencyKey: string; postings: Posting[];
  quoteId?: string; receivedMinor?: Minor; beneficiary?: string;
  outcome?: 'succeeded' | 'failed'; error?: string; sandbox: true;
}
export interface ProviderEvent {
  id: string; customerId: string; operationId: string; outcome: 'succeeded' | 'failed';
  amountMinor: Minor; currency: 'NGN'; createdAt: string;
}
export interface Reconciliation {
  ok: boolean; checkedAt: string; checkedOperations: number; pendingOperations: number;
  issues: Array<{ operationId: string; message: string }>;
}
