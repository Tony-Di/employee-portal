import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freshDatabase, testDatabaseUrl, PASSWORD } from './helpers.js';
import { authenticate } from '../src/services/admins.js';

const script = fileURLToPath(new URL('../scripts/admin.js', import.meta.url));

function run(args, input = '') {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, DATABASE_URL: testDatabaseUrl() } });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => resolve({ code, out }));
    child.stdin.end(input);
  });
}

async function db(t) {
  const pool = await freshDatabase();
  t.after(() => pool.end());
  return pool;
}

test('create reads the password twice from stdin and creates a working admin', async t => {
  const pool = await db(t);
  const res = await run(['create', '--email', 'ops@example.com', '--name', 'Ops'], `${PASSWORD}\n${PASSWORD}\n`);
  assert.equal(res.code, 0, res.out);
  assert.doesNotMatch(res.out, new RegExp(PASSWORD));
  assert.ok(await authenticate(pool, 'ops@example.com', PASSWORD));
});

test('create refuses mismatched passwords and creates nothing', async t => {
  const pool = await db(t);
  const res = await run(['create', '--email', 'ops@example.com', '--name', 'Ops'], `${PASSWORD}\nsomething else entirely\n`);
  assert.equal(res.code, 1);
  assert.match(res.out, /do not match/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM admins')).rows[0].n, 0);
});

test('reset-password, deactivate and activate change what can sign in', async t => {
  const pool = await db(t);
  await run(['create', '--email', 'ops@example.com', '--name', 'Ops'], `${PASSWORD}\n${PASSWORD}\n`);
  assert.equal((await run(['reset-password', '--email', 'ops@example.com'], 'another long password\nanother long password\n')).code, 0);
  assert.ok(await authenticate(pool, 'ops@example.com', 'another long password'));
  assert.equal((await run(['deactivate', '--email', 'ops@example.com'])).code, 0);
  assert.equal(await authenticate(pool, 'ops@example.com', 'another long password'), null);
  assert.equal((await run(['activate', '--email', 'ops@example.com'])).code, 0);
  assert.ok(await authenticate(pool, 'ops@example.com', 'another long password'));
});

test('commands for an unknown email fail with a clear message', async t => {
  await db(t);
  const res = await run(['deactivate', '--email', 'ghost@example.com']);
  assert.equal(res.code, 1);
  assert.match(res.out, /No admin/);
});

test('list shows admins without password hashes', async t => {
  await db(t);
  await run(['create', '--email', 'ops@example.com', '--name', 'Ops'], `${PASSWORD}\n${PASSWORD}\n`);
  const res = await run(['list']);
  assert.equal(res.code, 0);
  assert.match(res.out, /ops@example\.com/);
  assert.doesNotMatch(res.out, /scrypt/);
});
