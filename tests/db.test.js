import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, migrationFiles } from './helpers.js';
import { migrate, transaction } from '../src/db.js';

test('migrations apply once and seed the initial catalog', async t => {
  const pool = await freshDatabase();
  t.after(() => pool.end());
  await migrate(pool);
  await Promise.all([migrate(pool), migrate(pool)]);
  assert.deepEqual((await pool.query('SELECT name FROM migrations ORDER BY name')).rows.map(r => r.name), await migrationFiles());
  const sites = (await pool.query('SELECT name_en, status, url FROM sites ORDER BY sort_order')).rows;
  assert.deepEqual(sites, [
    { name_en: 'IT HelpDesk', status: 'published', url: 'https://helpdesk.seg.com' },
    { name_en: 'Another application', status: 'placeholder', url: null },
  ]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM portal_settings')).rows[0].n, 1);
});

test('a failed transaction leaves no partial writes', async t => {
  const pool = await freshDatabase();
  t.after(() => pool.end());
  await assert.rejects(transaction(pool, async client => {
    await client.query("INSERT INTO categories(name) VALUES ('临时')");
    throw new Error('boom');
  }), /boom/);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM categories WHERE name = '临时'")).rows[0].n, 0);
});

test('the database refuses a published site without an http(s) address', async t => {
  const pool = await freshDatabase();
  t.after(() => pool.end());
  await assert.rejects(pool.query("INSERT INTO sites(name, status, url) VALUES ('x', 'published', 'javascript:alert(1)')"), /check constraint/);
});
