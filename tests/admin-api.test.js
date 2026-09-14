import test from 'node:test';
import assert from 'node:assert/strict';
import { startPortal, PNG } from './helpers.js';

async function signedIn(t) {
  const p = await startPortal();
  await p.pool.query('DELETE FROM sites; DELETE FROM categories;');
  t.after(() => p.close());
  await p.admin();
  const browser = p.browser();
  await browser.login();
  const me = await browser.get('/api/admin/me');
  browser.csrf = me.json.csrfToken;
  return { p, browser };
}

test('JSON writes without the CSRF header are rejected with a JSON error', async t => {
  const { p, browser } = await signedIn(t);
  browser.csrf = '';
  const res = await browser.json('POST', '/api/admin/sites', { name: 'x', status: 'draft' });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'csrf');
  assert.equal((await p.pool.query('SELECT count(*)::int AS n FROM sites')).rows[0].n, 0);
});

test('sites can be created, read, partially updated and listed through the API', async t => {
  const { browser } = await signedIn(t);
  const created = await browser.json('POST', '/api/admin/sites', { name: '邮箱', url: 'https://mail.example.com', status: 'draft' });
  assert.equal(created.status, 201);
  const { id, version } = created.json.site;
  const patched = await browser.json('PATCH', `/api/admin/sites/${id}`, { status: 'published', version });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.site.status, 'published');
  assert.equal(patched.json.site.name, '邮箱');
  assert.equal((await browser.get(`/api/admin/sites/${id}`)).json.site.url, 'https://mail.example.com');
  assert.deepEqual((await browser.get('/api/admin/sites')).json.sites.map(s => s.id), [id]);
  assert.equal((await browser.get('/api/portal')).json.sites.length, 1);
});

test('API validation errors and conflicts are reported per field in the admin language', async t => {
  const { browser } = await signedIn(t);
  const invalid = await browser.json('POST', '/api/admin/sites?lang=en', { name: '', url: 'ftp://x', status: 'published' });
  assert.equal(invalid.status, 422);
  assert.deepEqual(Object.keys(invalid.json.errors).sort(), ['name', 'url']);
  assert.match(invalid.json.errors.url, /http:\/\/ or https:\/\//);
  const { json: { site } } = await browser.json('POST', '/api/admin/sites', { name: 'A', status: 'draft' });
  await browser.json('PATCH', `/api/admin/sites/${site.id}`, { name: 'B', version: site.version });
  const stale = await browser.json('PATCH', `/api/admin/sites/${site.id}`, { name: 'C', version: site.version });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error, 'conflict');
  assert.equal((await browser.json('PATCH', '/api/admin/sites/99999', { name: 'x' })).status, 404);
});

test('categories and their order are managed through the API', async t => {
  const { browser } = await signedIn(t);
  const a = (await browser.json('POST', '/api/admin/categories', { name: 'A' })).json.category;
  const b = (await browser.json('POST', '/api/admin/categories', { name: 'B' })).json.category;
  assert.equal((await browser.json('PATCH', `/api/admin/categories/${a.id}`, { name_en: 'Alpha' })).json.category.name_en, 'Alpha');
  assert.equal((await browser.json('PUT', '/api/admin/categories/order', { ids: [b.id, a.id] })).status, 200);
  assert.deepEqual((await browser.get('/api/admin/categories')).json.categories.map(c => c.name), ['B', 'A']);
  await browser.json('POST', '/api/admin/sites', { name: 'uses A', category_id: a.id, status: 'draft' });
  assert.equal((await browser.json('DELETE', `/api/admin/categories/${a.id}`)).status, 409);
  assert.equal((await browser.json('DELETE', `/api/admin/categories/${b.id}`)).status, 204);
});

test('settings and media uploads work through the API', async t => {
  const { browser } = await signedIn(t);
  const current = (await browser.get('/api/admin/settings')).json.settings;
  const upload = await browser.upload('/api/admin/media', {}, { file: { buffer: PNG, name: 'logo.png', type: 'image/png' } });
  assert.equal(upload.status, 201);
  const saved = await browser.json('PATCH', '/api/admin/settings', { title_en: 'Company Portal', logo_id: upload.json.media.id, version: current.version });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.settings.title_en, 'Company Portal');
  assert.equal((await browser.get('/api/portal')).json.settings.logo_url, upload.json.media.url);
  const bad = await browser.upload('/api/admin/media', {}, { file: { buffer: Buffer.from('not an image'), name: 'x.png' } });
  assert.equal(bad.status, 422);
  assert.ok(bad.json.errors.file);
});
