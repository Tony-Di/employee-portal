import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { freshDatabase } from './helpers.js';
import { createSite, getSite, listSites, moveSite, reorderSites, setSiteStatus, updateSite } from '../src/services/sites.js';
import { publicCatalog } from '../src/services/portal.js';
import { ConflictError, ValidationError } from '../src/errors.js';

async function db(t) {
  const pool = await freshDatabase();
  // Start from an empty catalog so expectations do not depend on the seed rows.
  await pool.query('DELETE FROM sites');
  t.after(() => pool.end());
  return pool;
}

async function rejectsWith(promise, fields) {
  const error = await promise.then(() => null, e => e);
  assert.ok(error instanceof ValidationError, `expected ValidationError, got ${error}`);
  assert.deepEqual(Object.keys(error.errors).sort(), [...fields].sort());
  for (const pair of Object.values(error.errors)) assert.equal(pair.length, 2, 'messages are [zh, en] pairs');
}

const names = sites => sites.map(s => s.name || s.name_en);

// Hold the row until both writers are waiting, so the overlap is deterministic.
async function concurrentEdits(pool, siteId, edits) {
  const blocker = await pool.connect();
  let results;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT 1 FROM sites WHERE id = $1 FOR UPDATE', [siteId]);
    results = Promise.allSettled(edits.map(input => updateSite(pool, siteId, input)));
    for (let attempt = 0; attempt < 500; attempt++) {
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
      if (rows[0].n >= edits.length) return results;
      await delay(10);
    }
    assert.fail('Both edits should wait for the locked site before continuing');
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await results;
  }
}

test('creates a draft with trimmed text, null empty address and next sort order', async t => {
  const pool = await db(t);
  const first = await createSite(pool, { name: '  门户A ', url: '', status: 'draft' });
  const second = await createSite(pool, { name_en: 'Mail', url: ' https://mail.example.com ', open_in_new_tab: '0', status: 'draft' });
  assert.equal(first.name, '门户A');
  assert.equal(first.url, null);
  assert.equal(first.status, 'draft');
  assert.equal(first.open_in_new_tab, true);
  assert.equal(second.url, 'https://mail.example.com');
  assert.equal(second.open_in_new_tab, false);
  assert.ok(second.sort_order > first.sort_order);
});

test('rejects invalid site input with bilingual field errors', async t => {
  const pool = await db(t);
  await rejectsWith(createSite(pool, { name: ' ', name_en: '', status: 'draft' }), ['name']);
  await rejectsWith(createSite(pool, { name: 'A', url: 'javascript:alert(1)', status: 'draft' }), ['url']);
  await rejectsWith(createSite(pool, { name: 'A', url: 'ftp://files.example.com', status: 'draft' }), ['url']);
  await rejectsWith(createSite(pool, { name: 'A', url: 'not a url', status: 'draft' }), ['url']);
  await rejectsWith(createSite(pool, { name: 'A', description: 'x'.repeat(241), status: 'draft' }), ['description']);
  await rejectsWith(createSite(pool, { name: 'A', icon_key: 'nope', status: 'draft' }), ['icon_key']);
  await rejectsWith(createSite(pool, { name: 'A', category_id: '999', status: 'draft' }), ['category_id']);
  await rejectsWith(createSite(pool, { name: 'A', media_id: '00000000-0000-4000-8000-000000000000', status: 'draft' }), ['media_id']);
  await rejectsWith(createSite(pool, { name: 'A', status: 'deleted' }), ['status']);
  assert.equal((await listSites(pool)).length, 0);
});

test('a site cannot be published without an address', async t => {
  const pool = await db(t);
  await rejectsWith(createSite(pool, { name: 'A', status: 'published' }), ['url']);
  const site = await createSite(pool, { name: 'A', status: 'placeholder' });
  await rejectsWith(setSiteStatus(pool, site.id, 'published'), ['url']);
  assert.equal((await getSite(pool, site.id)).status, 'placeholder');
});

test('the public catalog lists only published and placeholder sites in order', async t => {
  const pool = await db(t);
  await createSite(pool, { name: '草稿', url: 'https://draft.example.com', status: 'draft' });
  await createSite(pool, { name: '已发布', url: 'https://live.example.com', status: 'published' });
  await createSite(pool, { name: '隐藏', url: 'https://hidden.example.com', status: 'hidden' });
  await createSite(pool, { name: '占位', url: 'https://soon.example.com', status: 'placeholder' });
  const catalog = await publicCatalog(pool);
  assert.deepEqual(names(catalog.sites), ['已发布', '占位']);
  assert.equal(catalog.sites[0].url, 'https://live.example.com');
  assert.equal(catalog.sites[1].url, null, 'placeholders never expose a clickable address');
  for (const site of catalog.sites) {
    for (const key of ['created_by', 'updated_by', 'version', 'created_at']) assert.equal(key in site, false, key);
  }
});

test('hiding removes a site from the catalog and republishing restores it', async t => {
  const pool = await db(t);
  const site = await createSite(pool, { name: 'HelpDesk', url: 'https://helpdesk.example.com', status: 'published' });
  await setSiteStatus(pool, site.id, 'hidden');
  assert.deepEqual(names((await publicCatalog(pool)).sites), []);
  await setSiteStatus(pool, site.id, 'published');
  assert.deepEqual(names((await publicCatalog(pool)).sites), ['HelpDesk']);
});

test('catalog search matches names, descriptions and keywords in either language', async t => {
  const pool = await db(t);
  await createSite(pool, { name: 'IT 服务台', description: '设备报修', keywords: '电脑, 网络', url: 'https://a.example.com', status: 'published' });
  await createSite(pool, { name: '会议室', name_en: 'Meeting Rooms', url: 'https://b.example.com', status: 'published' });
  assert.deepEqual(names((await publicCatalog(pool, { q: '网络' })).sites), ['IT 服务台']);
  assert.deepEqual(names((await publicCatalog(pool, { q: '报修' })).sites), ['IT 服务台']);
  assert.deepEqual(names((await publicCatalog(pool, { q: 'meeting' })).sites), ['会议室']);
  assert.deepEqual(names((await publicCatalog(pool, { q: '100%_' })).sites), []);
});

test('public and admin searches rank multiword matches consistently while respecting visibility and status', async t => {
  const pool = await db(t);
  await createSite(pool, { name: 'Guide', description: 'IT support', url: 'https://guide.example.com', status: 'published' });
  await createSite(pool, { name: 'Support', keywords: 'IT', url: 'https://desk.example.com', status: 'published' });
  await createSite(pool, { name: 'IT Support', status: 'draft' });
  assert.deepEqual(names((await publicCatalog(pool, { q: 'IT support' })).sites), ['Support', 'Guide']);
  assert.deepEqual(names(await listSites(pool, { q: 'IT support' })), ['IT Support', 'Support', 'Guide']);
  assert.deepEqual(names(await listSites(pool, { q: 'IT support', status: 'published' })), ['Support', 'Guide']);
  assert.deepEqual(names(await listSites(pool, { q: 'desk.example IT' })), ['Support']);
  assert.deepEqual((await publicCatalog(pool, { q: 'desk.example' })).sites, []);
});

test('an edit based on a stale version is refused and changes nothing', async t => {
  const pool = await db(t);
  const site = await createSite(pool, { name: 'A', url: 'https://a.example.com', status: 'published' });
  const updated = await updateSite(pool, site.id, { name: 'B', version: String(site.version) });
  assert.equal(updated.name, 'B');
  assert.equal(updated.version, site.version + 1);
  await assert.rejects(updateSite(pool, site.id, { name: 'C', version: String(site.version) }), ConflictError);
  assert.equal((await getSite(pool, site.id)).name, 'B');
});

test('simultaneous edits with the same version cannot overwrite each other', async t => {
  const pool = await db(t);
  const site = await createSite(pool, { name: 'Original' });
  const results = await concurrentEdits(pool, site.id, [
    { name: 'First edit', version: site.version },
    { name: 'Second edit', version: site.version },
  ]);
  const succeeded = results.filter(r => r.status === 'fulfilled');
  const failed = results.filter(r => r.status === 'rejected');
  assert.equal(succeeded.length, 1, 'exactly one editor can save the original version');
  assert.equal(failed.length, 1);
  assert.ok(failed[0].reason instanceof ConflictError);
  const saved = await getSite(pool, site.id);
  assert.equal(saved.name, succeeded[0].value.name);
  assert.equal(saved.version, site.version + 1);
});

test('simultaneous partial updates preserve changes to different fields', async t => {
  const pool = await db(t);
  const site = await createSite(pool, { name: 'Original', description: 'Original description' });
  const results = await concurrentEdits(pool, site.id, [
    { name: 'Updated name' },
    { description: 'Updated description' },
  ]);
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'fulfilled']);
  const saved = await getSite(pool, site.id);
  assert.equal(saved.name, 'Updated name');
  assert.equal(saved.description, 'Updated description');
  assert.equal(saved.version, site.version + 2);
});

test('moving and reordering sites changes the catalog order', async t => {
  const pool = await db(t);
  const ids = [];
  for (const name of ['A', 'B', 'C']) ids.push((await createSite(pool, { name, url: `https://${name}.example.com`, status: 'published' })).id);
  await moveSite(pool, ids[2], 'up');
  assert.deepEqual(names((await publicCatalog(pool)).sites), ['A', 'C', 'B']);
  await moveSite(pool, ids[0], 'up');
  assert.deepEqual(names((await publicCatalog(pool)).sites), ['A', 'C', 'B'], 'moving the first site up is a no-op');
  await reorderSites(pool, [ids[1], ids[2], ids[0]]);
  assert.deepEqual(names((await publicCatalog(pool)).sites), ['B', 'C', 'A']);
  await rejectsWith(reorderSites(pool, [ids[1], ids[2]]), ['order']);
  await rejectsWith(reorderSites(pool, [ids[1], ids[1], ids[2]]), ['order']);
  assert.deepEqual(names((await publicCatalog(pool)).sites), ['B', 'C', 'A']);
});
