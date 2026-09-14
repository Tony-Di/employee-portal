import test from 'node:test';
import assert from 'node:assert/strict';
import { startPortal, PNG } from './helpers.js';
import { createSite } from '../src/services/sites.js';
import { createCategory, listCategories } from '../src/services/categories.js';
import { getSettings } from '../src/services/portal.js';

async function signedIn(t) {
  const p = await startPortal();
  await p.pool.query('DELETE FROM sites; DELETE FROM categories;');
  t.after(() => p.close());
  await p.admin();
  const browser = p.browser();
  await browser.login();
  return { p, browser };
}

test('categories can be added, renamed and deleted when empty', async t => {
  const { p, browser } = await signedIn(t);
  await browser.get('/admin/categories');
  assert.equal((await browser.post('/admin/categories', { name: '办公工具', name_en: 'Office' })).status, 303);
  const [category] = await listCategories(p.pool);
  assert.equal(category.name_en, 'Office');
  await browser.post(`/admin/categories/${category.id}`, { name: '办公', name_en: 'Office tools' });
  assert.equal((await listCategories(p.pool))[0].name, '办公');
  assert.equal((await browser.post(`/admin/categories/${category.id}/delete`)).status, 303);
  assert.deepEqual(await listCategories(p.pool), []);
});

test('deleting a category in use explains why and keeps it', async t => {
  const { p, browser } = await signedIn(t);
  const category = await createCategory(p.pool, { name: '使用中' });
  await createSite(p.pool, { name: 'A', category_id: String(category.id), status: 'draft' });
  await browser.get('/admin/categories');
  const res = await browser.post(`/admin/categories/${category.id}/delete`);
  assert.match((await browser.get(res.location)).text, /请先把这些网站移到其他分类/);
  assert.equal((await listCategories(p.pool)).length, 1);
});

test('an empty category name is reported', async t => {
  const { browser } = await signedIn(t);
  await browser.get('/admin/categories');
  const res = await browser.post('/admin/categories', { name: '', name_en: '' });
  assert.equal(res.status, 422);
  assert.match(res.text, /请至少填写中文或英文分类名称/);
});

test('categories can be moved up and down', async t => {
  const { p, browser } = await signedIn(t);
  const a = await createCategory(p.pool, { name: 'A' });
  await createCategory(p.pool, { name: 'B' });
  await browser.get('/admin/categories');
  await browser.post(`/admin/categories/${a.id}/move`, { direction: 'down' });
  assert.deepEqual((await listCategories(p.pool)).map(c => c.name), ['B', 'A']);
});

test('portal settings change the homepage title, description and logo', async t => {
  const { p, browser } = await signedIn(t);
  const settings = await getSettings(p.pool);
  await browser.get('/admin/settings');
  const res = await browser.upload('/admin/settings', {
    title: 'SEG 员工门户', title_en: 'SEG Portal', description: '从这里开始工作', description_en: 'Start here',
    default_language: 'zh', version: String(settings.version),
  }, { logo_file: { buffer: PNG, name: 'logo.png', type: 'image/png' } });
  assert.equal(res.status, 303);
  const home = (await p.browser().get('/')).text;
  assert.match(home, /<h1>SEG 员工门户<\/h1>/);
  assert.match(home, /从这里开始工作/);
  assert.match(home, /<img class="logo-custom" src="\/media\/[^"]+\.png"/);
});

test('invalid settings are reported and nothing is saved', async t => {
  const { p, browser } = await signedIn(t);
  const settings = await getSettings(p.pool);
  await browser.get('/admin/settings');
  const res = await browser.post('/admin/settings', { title: '', title_en: '', description: 'kept text', default_language: 'zh', version: String(settings.version) });
  assert.equal(res.status, 422);
  assert.match(res.text, /请至少填写中文或英文门户名称/);
  assert.match(res.text, />kept text<\/textarea>/);
  assert.equal((await getSettings(p.pool)).title, '员工门户');
});

test('the logo can be removed', async t => {
  const { p, browser } = await signedIn(t);
  await browser.get('/admin/settings');
  await browser.upload('/admin/settings', { title: '门户', title_en: '', description: '', description_en: '', default_language: 'zh', version: String((await getSettings(p.pool)).version) },
    { logo_file: { buffer: PNG, name: 'logo.png', type: 'image/png' } });
  assert.ok((await getSettings(p.pool)).logo_id);
  await browser.get('/admin/settings');
  await browser.post('/admin/settings', { title: '门户', title_en: '', description: '', description_en: '', default_language: 'zh', remove_logo: '1', version: String((await getSettings(p.pool)).version) });
  assert.equal((await getSettings(p.pool)).logo_id, null);
});

test('signed-out visitors cannot change anything', async t => {
  const p = await startPortal();
  t.after(() => p.close());
  const site = await createSite(p.pool, { name: '保持不变', url: 'https://keep.example.com', status: 'published' });
  const category = await createCategory(p.pool, { name: '分类' });
  const before = JSON.stringify((await p.pool.query('SELECT * FROM sites ORDER BY id')).rows) + JSON.stringify((await p.pool.query('SELECT * FROM categories ORDER BY id')).rows) + JSON.stringify(await getSettings(p.pool));
  const browser = p.browser();
  await browser.get('/admin/login');
  const attempts = [
    browser.post('/admin/sites', { name: 'x', status: 'draft' }),
    browser.post(`/admin/sites/${site.id}`, { name: 'x' }),
    browser.post(`/admin/sites/${site.id}/status`, { status: 'hidden' }),
    browser.post(`/admin/sites/${site.id}/move`, { direction: 'down' }),
    browser.post('/admin/categories', { name: 'x' }),
    browser.post(`/admin/categories/${category.id}/delete`),
    browser.post('/admin/settings', { title: 'x' }),
    browser.upload('/admin/settings', { title: 'x' }, { logo_file: { buffer: PNG, name: 'l.png' } }),
    browser.json('POST', '/api/admin/sites', { name: 'x', status: 'draft' }),
    browser.json('PATCH', `/api/admin/sites/${site.id}`, { status: 'hidden' }),
    browser.json('PUT', '/api/admin/sites/order', { ids: [site.id] }),
    browser.json('PATCH', '/api/admin/settings', { title: 'x' }),
    browser.json('DELETE', `/api/admin/categories/${category.id}`),
    browser.upload('/api/admin/media', {}, { file: { buffer: PNG, name: 'l.png' } }),
  ];
  for (const res of await Promise.all(attempts)) assert.ok([302, 401].includes(res.status), `status ${res.status}`);
  const after = JSON.stringify((await p.pool.query('SELECT * FROM sites ORDER BY id')).rows) + JSON.stringify((await p.pool.query('SELECT * FROM categories ORDER BY id')).rows) + JSON.stringify(await getSettings(p.pool));
  assert.equal(after, before);
  assert.equal((await p.pool.query('SELECT count(*)::int AS n FROM media')).rows[0].n, 0);
});
