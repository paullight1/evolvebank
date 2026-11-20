import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ProviderEvent } from '../../../packages/banking/contracts.js';

export class WebhookError extends Error {}
export function signProviderEvent(raw: Buffer, timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(timestamp).update('.').update(raw).digest('hex');
}
export function verifyProviderEvent(raw: Buffer, timestamp: unknown, signature: unknown, secret: string, now = Date.now()): ProviderEvent {
  if (typeof timestamp !== 'string' || !/^\d{10,13}$/.test(timestamp) || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) throw new WebhookError('Invalid event signature');
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(now / 1000) - seconds) > 300) throw new WebhookError('Event timestamp is outside the acceptance window');
  const expected = Buffer.from(signProviderEvent(raw, timestamp, secret), 'hex');
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), expected)) throw new WebhookError('Invalid event signature');
  let body: unknown;
  try { body = JSON.parse(raw.toString('utf8')); } catch { throw new WebhookError('Invalid event JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new WebhookError('Invalid event');
  const e = body as Record<string, unknown>;
  const string = (v: unknown, max = 160) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (!string(e.id) || !string(e.customerId) || !string(e.operationId) || !string(e.createdAt, 40) ||
      !Number.isFinite(Date.parse(e.createdAt as string)) || !string(e.amountMinor, 16) || !/^[1-9]\d*$/.test(e.amountMinor as string) ||
      e.currency !== 'NGN' || !['succeeded','failed'].includes(e.outcome as string)) throw new WebhookError('Invalid event fields');
  return e as unknown as ProviderEvent;
}
