import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const secret = () => randomBytes(32).toString('hex');
try {
  await writeFile('.env', `POSTGRES_PASSWORD=${secret()}\nBLNK_API_KEY=${secret()}\nSANDBOX_WEBHOOK_SECRET=${secret()}\n`, { mode: 0o600, flag: 'wx' });
  console.log('Created local sandbox configuration. Start with: docker compose up --build --wait');
} catch (error) {
  if (error.code === 'EEXIST') console.log('Existing .env preserved. Start with: docker compose up --build --wait');
  else throw error;
}
