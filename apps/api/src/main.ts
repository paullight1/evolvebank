import 'reflect-metadata';
import { resolve } from 'node:path';
import { BankingService } from '../../../packages/banking/service.js';
import { BlnkLedger } from '../../../packages/ledger/blnk.js';
import { PostgresStore } from '../../../packages/storage/postgres.js';
import { createApp } from './app.js';
import { Sessions } from './sessions.js';

async function main() {
  if (process.env.APP_ENV !== 'sandbox') throw new Error('This build only runs with APP_ENV=sandbox');
  const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name} must be configured`); return value; };
  const store = new PostgresStore({ connectionString: required('DATABASE_URL'), max: 12, connectionTimeoutMillis: 10000 });
  await store.initialize();
  const ledger = new BlnkLedger(store, { baseUrl: required('BLNK_URL'), apiKey: required('BLNK_API_KEY') });
  const banking = new BankingService(store, ledger);
  const app = await createApp({ store, ledger, banking, sessions: new Sessions(store) }, {
    webhookSecret: required('SANDBOX_WEBHOOK_SECRET'),
    trustedOrigins: (process.env.TRUSTED_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:4173,http://127.0.0.1:4173').split(',').map(x=>x.trim()),
    cookieSecure: process.env.COOKIE_SECURE === 'true', staticDirectory: resolve('dist/portal'), health: () => store.health(),
  });
  await app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1');
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await app.close(); await store.close(); };
  process.on('SIGTERM', () => void stop()); process.on('SIGINT', () => void stop());
  console.log(`Evolve sandbox listening on port ${process.env.PORT ?? 3000}; no real funds`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Sandbox startup failed'); process.exitCode = 1; });
