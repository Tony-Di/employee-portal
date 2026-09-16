import test from 'node:test';
import assert from 'node:assert/strict';
import { startPortal, PNG } from './helpers.js';
import { createSite, getSite } from '../src/services/sites.js';

async function signedIn(t) {
  const p = await startPortal();
  await p.pool.query('DELETE FROM sites');
  t.after(() => p.close());
  await p.admin();
  const browser = p.browser();
  await browser.login();
  return { p, browser };
}

const homeNames = async p => {
  const html = (await p.browser().get('/')).text;
  return [...html.matchAll(/<li class="card-item"([^>]*)>[\s\S]*?<h2 class="card-title"[^>]*>([^<]*)<\/h2>/g)].map(m => m[2]);
};

const siteForm = fields => ({
  name: '', name_en: '', description: '', description_en: '', url: '', icon_key: 'globe', category_id: '',
  keywords: '', open_in_new_tab: '1', ...fields,
});

test('a new site saved as a draft is only visible in the admin console', async t => {
  const { p, browser } = await signedIn(t);
  await browser.get('/admin/sites/new');
  const res = await browser.post('/admin/sites', siteForm({ name: '考勤系统', url: 'https://hr.example.com', status: 'draft' }));
  assert.equal(res.status, 303);
  const [, id] = res.location.match(/^\/admin\/sites\/(\d+)\/edit$/);
  assert.equal((await getSite(p.pool, id)).status, 'draft');
  assert.deepEqual(await homeNames(p), []);
  const list = await browser.get('/admin/sites');
  assert.match(list.text, /考勤系统/);
  assert.match(list.text, /草稿/);
});

test('publishing a new site makes it visible to a fresh employee session', async t => {
  const { p, browser } = await signedIn(t);
  await browser.get('/admin/sites/new');
  const res = await browser.post('/admin/sites', siteForm({ name: 'IT HelpDesk', url: 'https://helpdesk.example.com', status: 'published' }));
  assert.equal(res.status, 303);
  assert.deepEqual(await homeNames(p), ['IT HelpDesk']);
  assert.match((await browser.get(res.location)).text, /已发布/);
});

test('an invalid address is reported and the form keeps what was typed', async t => {
  const { p, browser } = await signedIn(t);
  await browser.get('/admin/sites/new');
  const res = await browser.post('/admin/sites', siteForm({ name: '报销系统', description: '差旅报销', url: 'javascript:alert(1)', status: 'published' }));
  assert.equal(res.status, 422);
  assert.match(res.text, /请输入以 http:\/\/ 或 https:\/\/ 开头的有效网址/);
  assert.match(res.text, /value="报销系统"/);
  assert.match(res.text, />差旅报销<\/textarea>/);
  assert.match(res.text, /value="javascript:alert\(1\)"/);
  assert.equal((await p.pool.query('SELECT count(*)::int AS n FROM sites')).rows[0].n, 0);
});

test('editing a published site updates the homepage without a rebuild', async t => {
  const { p, browser } = await signedIn(t);
  const site = await createSite(p.pool, { name: '旧名称', url: 'https://old.example.com', status: 'published' });
  const edit = await browser.get(`/admin/sites/${site.id}/edit`);
  assert.match(edit.text, /保存并更新首页/);
  const res = await browser.post(`/admin/sites/${site.id}`, siteForm({ name: '新名称', url: 'https://new.example.com', status: 'published', version: String(site.version) }));
  assert.equal(res.status, 303);
  assert.deepEqual(await homeNames(p), ['新名称']);
  assert.match((await p.browser().get('/')).text, /href="https:\/\/new\.example\.com"/);
});

test('a stale edit is refused with the typed values kept and the saved site untouched', async t => {
  const { p, browser } = await signedIn(t);
  const site = await createSite(p.pool, { name: '原始', url: 'https://a.example.com', status: 'published' });
  await browser.get(`/admin/sites/${site.id}/edit`);
  await p.pool.query("UPDATE sites SET name = '别人改过', version = version + 1 WHERE id = $1", [site.id]);
  const res = await browser.post(`/admin/sites/${site.id}`, siteForm({ name: '我的修改', url: 'https://a.example.com', status: 'published', version: String(site.version) }));
  assert.equal(res.status, 409);
  assert.match(res.text, /已被其他管理员修改/);
  assert.match(res.text, /value="我的修改"/);
  assert.equal((await getSite(p.pool, site.id)).name, '别人改过');
});

test('hiding and republishing from the list changes the homepage and the API', async t => {
  const { p, browser } = await signedIn(t);
  const site = await createSite(p.pool, { name: 'HelpDesk', url: 'https://helpdesk.example.com', status: 'published' });
  await browser.get('/admin/sites');
  const hide = await browser.post(`/admin/sites/${site.id}/status`, { status: 'hidden' });
  assert.equal(hide.status, 303);
  assert.deepEqual(await homeNames(p), []);
  assert.deepEqual((await p.browser().get('/api/portal')).json.sites, []);
  await browser.post(`/admin/sites/${site.id}/status`, { status: 'published' });
  assert.deepEqual(await homeNames(p), ['HelpDesk']);
});

test('publishing a placeholder without an address shows the reason on the list', async t => {
  const { p, browser } = await signedIn(t);
  const site = await createSite(p.pool, { name: '第二个网站', status: 'placeholder' });
  await browser.get('/admin/sites');
  const res = await browser.post(`/admin/sites/${site.id}/status`, { status: 'published' });
  assert.equal(res.status, 303);
  assert.match((await browser.get(res.location)).text, /发布前请填写网站地址/);
  assert.equal((await getSite(p.pool, site.id)).status, 'placeholder');
});

test('up and down buttons reorder the homepage', async t => {
  const { p, browser } = await signedIn(t);
  const ids = [];
  for (const name of ['A', 'B', 'C']) ids.push((await createSite(p.pool, { name, url: `https://${name}.example.com`, status: 'published' })).id);
  await browser.get('/admin/sites');
  assert.equal((await browser.post(`/admin/sites/${ids[2]}/move`, { direction: 'up' })).status, 303);
  assert.deepEqual(await homeNames(p), ['A', 'C', 'B']);
  await browser.post(`/admin/sites/${ids[0]}/move`, { direction: 'down' });
  assert.deepEqual(await homeNames(p), ['C', 'A', 'B']);
});

test('drag-and-drop order is saved through the JSON endpoint', async t => {
  const { p, browser } = await signedIn(t);
  const ids = [];
  for (const name of ['A', 'B', 'C']) ids.push((await createSite(p.pool, { name, url: `https://${name}.example.com`, status: 'published' })).id);
  await browser.get('/admin/sites');
  const res = await browser.json('PUT', '/api/admin/sites/order', { ids: [ids[1], ids[0], ids[2]] });
  assert.equal(res.status, 200);
  assert.deepEqual(await homeNames(p), ['B', 'A', 'C']);
  const stale = await browser.json('PUT', '/api/admin/sites/order', { ids: [ids[0], ids[1]] });
  assert.equal(stale.status, 422);
  assert.ok(stale.json.errors.order);
});

test('an uploaded icon is attached to the site and shown on the homepage', async t => {
  const { p, browser } = await signedIn(t);
  await browser.get('/admin/sites/new');
  const res = await browser.upload('/admin/sites', siteForm({ name: 'Pic', url: 'https://pic.example.com', status: 'published' }),
    { icon_file: { buffer: PNG, name: 'logo.png', type: 'image/png' } });
  assert.equal(res.status, 303);
  const html = (await p.browser().get('/')).text;
  const [, src] = html.match(/<img src="(\/media\/[^"]+\.png)"/);
  assert.equal((await fetch(p.url + src)).status, 200);
});

test('the site editor allows local image previews while keeping scripts restricted', async t => {
  const { browser } = await signedIn(t);
  const page = await browser.get('/admin/sites/new');
  assert.equal(page.status, 200);
  const policy = Object.fromEntries(page.headers.get('content-security-policy').split(';').map(directive => {
    const [name, ...sources] = directive.trim().split(/\s+/);
    return [name, sources];
  }));
  assert.ok(policy['img-src'].includes('blob:'), 'file selections use blob URLs before upload');
  assert.ok(policy['img-src'].includes("'self'"), 'saved images remain available');
  assert.ok(!policy['script-src'].includes('blob:'), 'image previews do not need blob scripts');
  assert.ok(!policy['script-src'].includes("'unsafe-inline'"));
});

test('an invalid icon upload is rejected and nothing is saved', async t => {
  const { p, browser } = await signedIn(t);
  await browser.get('/admin/sites/new');
  const res = await browser.upload('/admin/sites', siteForm({ name: 'Bad', url: 'https://bad.example.com', status: 'published' }),
    { icon_file: { buffer: Buffer.from('<svg onload="alert(1)"/>'), name: 'logo.png', type: 'image/png' } });
  assert.equal(res.status, 422);
  assert.match(res.text, /仅支持 PNG、JPEG 或 WebP/);
  assert.match(res.text, /value="Bad"/);
  assert.equal((await p.pool.query('SELECT count(*)::int AS n FROM sites')).rows[0].n, 0);
});

test('the site list filters by status and search text', async t => {
  const { p, browser } = await signedIn(t);
  await createSite(p.pool, { name: '邮箱', url: 'https://mail.example.com', status: 'published' });
  await createSite(p.pool, { name: '报表', status: 'draft' });
  const drafts = await browser.get('/admin/sites?status=draft');
  assert.match(drafts.text, /报表/);
  assert.doesNotMatch(drafts.text, /邮箱/);
  const search = await browser.get('/admin/sites?q=mail');
  assert.match(search.text, /邮箱/);
  assert.doesNotMatch(search.text, /报表/);
});

test('unknown site ids return 404', async t => {
  const { browser } = await signedIn(t);
  assert.equal((await browser.get('/admin/sites/999999/edit')).status, 404);
  assert.equal((await browser.get('/admin/sites/abc/edit')).status, 404);
});
