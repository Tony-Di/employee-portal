import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Creates .env from .env.example with a fresh session secret. Returns false when .env already exists.
export async function createEnvFile(dir) {
  const template = await readFile(path.join(dir, '.env.example'), 'utf8');
  const secret = randomBytes(32).toString('hex');
  const content = template.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`);
  try {
    await writeFile(path.join(dir, '.env'), content, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}
