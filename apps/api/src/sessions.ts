import { createHash, randomBytes } from 'node:crypto';
import type { Store } from '../../../packages/banking/contracts.js';
export interface Session { id: string; customerId: string; expiresAt: number; revoked: boolean; }
export const SESSION_COOKIE = 'evolve_sandbox_session';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export class Sessions {
  constructor(private readonly store: Store, private readonly now = Date.now) {}
  async create(customerId: string) {
    const token = randomBytes(32).toString('hex');
    const session: Session = { id: digest(token), customerId, expiresAt: this.now() + 24*60*60*1000, revoked: false };
    await this.store.put('sessions', session.id, session);
    return { token, session };
  }
  async resolve(token?: string): Promise<Session | undefined> {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return undefined;
    const session = await this.store.get<Session>('sessions', digest(token));
    return session && !session.revoked && session.expiresAt > this.now() ? session : undefined;
  }
  async revoke(token?: string) {
    const session = await this.resolve(token);
    if (session) await this.store.put('sessions', session.id, { ...session, revoked: true });
  }
}
export function readSessionCookie(header?: string): string | undefined {
  const values = header?.split(';').map(x => x.trim()).filter(x => x.startsWith(SESSION_COOKIE + '=')) ?? [];
  return values.length === 1 ? values[0].slice(SESSION_COOKIE.length + 1) : undefined;
}
