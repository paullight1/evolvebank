import type { Currency } from '../../../packages/banking/contracts';

/** Format integer cents/kobo without converting large balances to floating point. */
export function money(minor: string, currency: Currency): string {
  if (!/^-?\d+$/.test(minor)) return 'Unavailable';
  const value = BigInt(minor);
  const absolute = value < 0n ? -value : value;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${value < 0n ? '−' : ''}${currency === 'USD' ? '$' : '₦'}${whole}.${fraction}`;
}

export function decimal(minor: string): string {
  if (!/^\d+$/.test(minor)) return '0.00';
  const value = BigInt(minor);
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

export function amountError(value: string, minimum: bigint = 1n): string | undefined {
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(value)) return 'Use a positive amount with up to two decimal places.';
  const [whole, fraction = ''] = value.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor < minimum) return minimum === 101n ? 'Enter more than $1.00 to cover the demo conversion fee.' : 'Enter an amount greater than zero.';
  if (minor > 999999999n) return 'This amount exceeds the sandbox limit.';
  return undefined;
}
