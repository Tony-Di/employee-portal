import pg from 'pg';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPool, migrate } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createAdmin } from '../src/services/admins.js';

export const PASSWORD = 'correct horse battery';

// Tests wipe the target database, so refuse anything that is not clearly a test database.
export function testDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required. Run npm run setup first.');
  if (!new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must name a database ending in _test.');
  return url;
}

async function ensureDatabase(url) {
  const target = new URL(url);
  const name = target.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.href });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!exists.rowCount) await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally { await client.end(); }
}

export async function freshDatabase() {
  const url = testDatabaseUrl();
  await ensureDatabase(url);
  const pool = createPool(url);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  return pool;
}

export function testConfig(dataDir, overrides = {}) {
  return {
    production: false, port: 0, origin: 'http://localhost', databaseUrl: testDatabaseUrl(), host: '127.0.0.1',
    sessionSecret: 'test-secret-that-is-at-least-32-characters', secureCookies: false, trustProxy: false,
    dataDir, loginAttempts: 1000, ...overrides,
  };
}

export async function startPortal(overrides = {}) {
  const pool = await freshDatabase();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'portal-test-'));
  const errors = [];
  const app = createApp({ config: testConfig(dataDir, overrides), pool, logger: { error: e => errors.push(e) } });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    pool, url, dataDir, errors,
    // Most assertions check Chinese copy, so test browsers default to a saved Chinese preference; pass { lang: null } for a first-time visitor.
    browser: ({ lang = 'zh' } = {}) => new Browser(url, { lang }),
    admin: (email = 'admin@example.com', name = 'Admin') => createAdmin(pool, { name, email, password: PASSWORD }),
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await pool.end();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

// Minimal cookie-keeping HTTP client that behaves like a browser submitting forms.
export class Browser {
  constructor(base, { lang = null } = {}) {
    this.base = base; this.cookies = new Map(); this.csrf = null;
    if (lang) this.cookies.set('portal_lang', lang);
  }

  async request(pathname, { method = 'GET', headers = {}, body } = {}) {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(this.base + pathname, { method, body, redirect: 'manual', headers: { ...headers, ...(cookie && { cookie }) } });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await res.text();
    const token = text.match(/name="_csrf" value="([a-f0-9]+)"/) || text.match(/name="csrf-token" content="([a-f0-9]+)"/);
    if (token) this.csrf = token[1];
    let json;
    if ((res.headers.get('content-type') || '').includes('application/json')) json = JSON.parse(text);
    return { status: res.status, location: res.headers.get('location'), headers: res.headers, text, json };
  }

  get(pathname) { return this.request(pathname); }

  post(pathname, fields = {}) {
    const body = new URLSearchParams({ _csrf: this.csrf || '', ...fields });
    return this.request(pathname, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  }

  json(method, pathname, data) {
    return this.request(pathname, {
      method, body: data === undefined ? undefined : JSON.stringify(data),
      headers: { 'content-type': 'application/json', 'x-csrf-token': this.csrf || '' },
    });
  }

  upload(pathname, fields = {}, files = {}) {
    const form = new FormData();
    form.set('_csrf', this.csrf || '');
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    for (const [k, { buffer, name, type = 'application/octet-stream' }] of Object.entries(files)) form.set(k, new Blob([buffer], { type }), name);
    return this.request(pathname, { method: 'POST', body: form, headers: { 'x-csrf-token': this.csrf || '' } });
  }

  async login(email = 'admin@example.com', password = PASSWORD) {
    await this.get('/admin/login');
    return this.post('/admin/login', { email, password });
  }
}

export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

export async function migrationFiles() {
  return (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
}
