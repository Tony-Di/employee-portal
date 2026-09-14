import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEnvFile } from '../src/setup.js';
import { getConfig } from '../src/config.js';

const example = 'NODE_ENV=development\nDATABASE_URL=postgresql://u:p@127.0.0.1:55432/employee_portal\nSESSION_SECRET=replace-with-a-random-secret-of-at-least-32-characters\n';

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'portal-setup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, '.env.example'), example);
  return dir;
}

const parse = text => Object.fromEntries(text.trim().split('\n').filter(l => l && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

test('creates .env with a usable random session secret', async t => {
  const dir = await tempDir(t);
  assert.equal(await createEnvFile(dir), true);
  const env = parse(await readFile(path.join(dir, '.env'), 'utf8'));
  assert.match(env.SESSION_SECRET, /^[a-f0-9]{64}$/);
  assert.equal(env.DATABASE_URL, 'postgresql://u:p@127.0.0.1:55432/employee_portal');
  assert.doesNotThrow(() => getConfig(env));
});

test('each setup generates a different secret', async t => {
  const [a, b] = [await tempDir(t), await tempDir(t)];
  await createEnvFile(a); await createEnvFile(b);
  const secret = async dir => parse(await readFile(path.join(dir, '.env'), 'utf8')).SESSION_SECRET;
  assert.notEqual(await secret(a), await secret(b));
});

test('never overwrites an existing .env', async t => {
  const dir = await tempDir(t);
  await writeFile(path.join(dir, '.env'), 'SESSION_SECRET=keep-me\n');
  assert.equal(await createEnvFile(dir), false);
  assert.equal(await readFile(path.join(dir, '.env'), 'utf8'), 'SESSION_SECRET=keep-me\n');
});
