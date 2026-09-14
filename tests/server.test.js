import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { testDatabaseUrl, freshDatabase, migrationFiles, startPortal } from './helpers.js';

const serverScript = fileURLToPath(new URL('../src/server.js', import.meta.url));

const freePort = () => new Promise(resolve => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function waitFor(url, child, output) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${output.text}`);
    try { return await fetch(url); } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error(`server did not start:\n${output.text}`);
}

test('the server migrates an empty database, serves the portal and stops cleanly on SIGTERM', async t => {
  const pool = await freshDatabase();
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.end();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'portal-server-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const port = await freePort();
  const child = spawn(process.execPath, [serverScript], {
    env: { PATH: process.env.PATH, NODE_ENV: 'development', PORT: String(port), DATABASE_URL: testDatabaseUrl(), SESSION_SECRET: 'x'.repeat(40), DATA_DIR: dataDir },
  });
  const output = { text: '' };
  child.stdout.on('data', d => { output.text += d; });
  child.stderr.on('data', d => { output.text += d; });
  t.after(() => child.kill('SIGKILL'));

  const home = await waitFor(`http://127.0.0.1:${port}/`, child, output);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /IT HelpDesk/);
  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const exited = new Promise(resolve => child.on('exit', code => resolve(code)));
  child.kill('SIGTERM');
  assert.equal(await exited, 0, output.text);

  const check = new pg.Client({ connectionString: testDatabaseUrl() });
  await check.connect();
  t.after(() => check.end());
  assert.deepEqual((await check.query('SELECT name FROM migrations ORDER BY name')).rows.map(r => r.name), await migrationFiles());
});

test('the server refuses to start with an unsafe configuration', async () => {
  const child = spawn(process.execPath, [serverScript], {
    env: { PATH: process.env.PATH, DATABASE_URL: testDatabaseUrl(), SESSION_SECRET: 'replace-with-a-random-secret-of-at-least-32-characters' },
  });
  let text = '';
  child.stderr.on('data', d => { text += d; });
  const code = await new Promise(resolve => child.on('exit', resolve));
  assert.equal(code, 1);
  assert.match(text, /SESSION_SECRET/);
});

test('the health check reports an unavailable database', async t => {
  const p = await startPortal();
  t.after(async () => { await p.close().catch(() => {}); });
  assert.equal((await fetch(`${p.url}/healthz`)).status, 200);
  await p.pool.end();
  p.pool.end = async () => {};
  const res = await fetch(`${p.url}/healthz`);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false });
});
