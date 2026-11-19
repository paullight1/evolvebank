import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteUsdToNgn } from '../apps/portal/quote.mjs';

test('transparent demo quote: $100 → ₦99,000 after $1 fee', () => {
  const result = quoteUsdToNgn('100.00');
  assert.equal(result.amountNgnKobo, 9_900_000n);
  assert.equal(result.rateNgnPerUsd, 1000n);
  assert.equal(result.demo, true);
  assert.equal(result.executable, false);
});
test('minor-unit precision without float rounding', () => {
  assert.equal(quoteUsdToNgn('1.01').amountNgnKobo, 1000n);
  assert.equal(quoteUsdToNgn('10.99').amountNgnKobo, 999000n);
});
test('bad inputs cannot produce executable quotes', () => {
  for (const value of ['', '0', '1', '0.01', '1.00', '-100', 'Infinity', '2.000', '20000000', '1e5', ' 10 ']) {
    assert.throws(() => quoteUsdToNgn(value), RangeError, value);
  }
});
