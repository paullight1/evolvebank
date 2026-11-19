// SANDBOX ONLY. This rate is deliberately fictitious, not a financial quote.
// Exact integer-cents arithmetic, no order execution.
const RATE_NGN_PER_USD = 1000n; // DEMO RATE, NOT MARKET DATA
const FLAT_FEE_CENTS = 100n; // $1 illustrative fee
export function quoteUsdToNgn(rawAmount) {
  if (typeof rawAmount !== 'string' || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(rawAmount)) {
    throw new RangeError('Enter a USD amount from 1.01 to 9999999.99 with no more than two decimal places.');
  }
  const [dollars, fractions = ''] = rawAmount.split('.');
  const usdCents = BigInt(dollars) * 100n + BigInt(fractions.padEnd(2, '0'));
  if (usdCents <= FLAT_FEE_CENTS || usdCents > 999999999n) {
    throw new RangeError('Enter a USD amount from 1.01 to 9999999.99.');
  }
  const ngnKobo = (usdCents - FLAT_FEE_CENTS) * RATE_NGN_PER_USD;
  return { demo: true, executable: false, currencyFrom: 'USD', currencyTo: 'NGN', amountUsdCents: usdCents, feeUsdCents: FLAT_FEE_CENTS, rateNgnPerUsd: RATE_NGN_PER_USD, amountNgnKobo: ngnKobo };
}
