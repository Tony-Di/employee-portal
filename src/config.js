import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function getConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required. Run npm run setup, then configure .env.');
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || env.SESSION_SECRET.startsWith('replace-with')) {
    throw new Error('Set SESSION_SECRET to a random value of at least 32 characters.');
  }
  const port = Number(env.PORT || 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  const origin = new URL(env.APP_ORIGIN || `http://localhost:${port}`).origin;
  if (production && !origin.startsWith('https://')) throw new Error('Production APP_ORIGIN must use HTTPS.');
  if (production && env.COOKIE_SECURE === 'false') throw new Error('Production cookies require HTTPS.');
  return {
    production, port, origin, databaseUrl: env.DATABASE_URL,
    host: env.HOST || '127.0.0.1',
    sessionSecret: env.SESSION_SECRET,
    secureCookies: production || env.COOKIE_SECURE === 'true',
    trustProxy: env.TRUST_PROXY === '1' ? 1 : false,
    dataDir: path.resolve(root, env.DATA_DIR || 'data'),
  };
}
