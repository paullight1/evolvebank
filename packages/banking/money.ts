import { BankingError } from './errors.js';

export const MAX_MINOR = 999_999_999n;
export const SANDBOX_USD_LIMIT = 1_000_000n; // $10,000 per sandbox receipt or conversion.
export const QUOTE_FEE_USD_MINOR = 100n;
export const DEMO_NGN_PER_USD = 1000n;

/** Parse a human decimal amount without passing through binary floating point. */
export function parseAmount(raw: string, maximum = MAX_MINOR, minimum = 1n): bigint {
  if (typeof raw !== 'string' || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(raw)) {
    throw new BankingError(400, 'INVALID_AMOUNT', 'Enter a positive amount with no more than two decimal places.');
  }
  const [whole = '0', decimals = ''] = raw.split('.');
  const value = BigInt(whole) * 100n + BigInt(decimals.padEnd(2, '0'));
  if (value < minimum || value > maximum) {
    throw new BankingError(400, 'INVALID_AMOUNT', `Amount must be between ${formatMinor(minimum)} and ${formatMinor(maximum)}.`);
  }
  return value;
}

function formatMinor(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
