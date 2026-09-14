import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '../src/config.js';

const base = { DATABASE_URL: 'postgresql://u:p@localhost/db', SESSION_SECRET: 'a'.repeat(32) };

test('rejects missing or placeholder secrets', () => {
  assert.throws(() => getConfig({ ...base, SESSION_SECRET: 'short' }), /SESSION_SECRET/);
  assert.throws(() => getConfig({ ...base, SESSION_SECRET: 'replace-with-a-random-secret-of-at-least-32-characters' }), /SESSION_SECRET/);
  assert.throws(() => getConfig({ SESSION_SECRET: base.SESSION_SECRET }), /DATABASE_URL/);
});

test('production requires HTTPS and forces secure cookies', () => {
  assert.throws(() => getConfig({ ...base, NODE_ENV: 'production', APP_ORIGIN: 'http://portal.example' }), /HTTPS/);
  const config = getConfig({ ...base, NODE_ENV: 'production', APP_ORIGIN: 'https://portal.example' });
  assert.equal(config.secureCookies, true);
  assert.equal(config.origin, 'https://portal.example');
});

test('development defaults bind to localhost without secure cookies', () => {
  const config = getConfig(base);
  assert.deepEqual([config.host, config.port, config.secureCookies, config.trustProxy], ['127.0.0.1', 3100, false, false]);
  assert.equal(getConfig({ ...base, TRUST_PROXY: '1' }).trustProxy, 1);
  assert.throws(() => getConfig({ ...base, PORT: '70000' }), /PORT/);
});
