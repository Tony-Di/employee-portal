import test from 'node:test';
import assert from 'node:assert/strict';
import { startPortal, PNG } from './helpers.js';
import { createSite } from '../src/services/sites.js';
import { createCategory } from '../src/services/categories.js';
import { saveMedia } from '../src/services/media.js';

async function portal(t, { keepSeed = false } = {}) {
  const p = await startPortal();
  if (!keepSeed) await p.pool.query('DELETE FROM sites');
  t.after(() => p.close());
  return p;
}

// Names of cards a visitor can see: filtered-out cards stay in the page (for instant filtering) but are hidden.
const cardNames = html => [...html.matchAll(/<li class="card-item"([^>]*)>[\s\S]*?<h2 class="card-title"[^>]*>([^<]*)<\/h2>/g)]
  .filter(m => !/\shidden(\s|$|=)/.test(m[1])).map(m => m[2]);

test('the homepage shows published and placeholder sites in order, never drafts or hidden sites', async t => {
  const p = await portal(t);
  await createSite(p.pool, { name: '草稿网站', url: 'https://draft.example.com', status: 'draft' });
  await createSite(p.pool, { name: 'IT HelpDesk', url: 'https://helpdesk.example.com', status: 'published' });
  await createSite(p.pool, { name: '隐藏网站', url: 'https://hidden.example.com', status: 'hidden' });
  await createSite(p.pool, { name: '待定系统', url: 'https://secret-soon.example.com', status: 'placeholder' });
  const res = await p.browser().get('/');
  assert.equal(res.status, 200);
  assert.deepEqual(cardNames(res.text), ['IT HelpDesk', '待定系统']);
  assert.doesNotMatch(res.text, /draft\.example\.com|hidden\.example\.com|secret-soon\.example\.com/);
  assert.match(res.text, /<a class="card-open" href="https:\/\/helpdesk\.example\.com" target="_blank" rel="noopener noreferrer"/);
  assert.match(res.text, /aria-disabled="true"[^>]*>待补充</);
});

test('a site set to open in the current tab has no target attribute', async t => {
  const p = await portal(t);
  await createSite(p.pool, { name: 'Wiki', url: 'https://wiki.example.com', open_in_new_tab: '0', status: 'published' });
  const res = await p.browser().get('/');
  assert.match(res.text, /href="https:\/\/wiki\.example\.com">/);
});

test('admin-entered text is escaped on the homepage', async t => {
  const p = await portal(t);
  await createSite(p.pool, { name: '<img src=x onerror=alert(1)>', description: '"><script>alert(1)</script>', url: 'https://x.example.com', status: 'published' });
  const res = await p.browser().get('/');
  assert.doesNotMatch(res.text, /<img src=x|<script>alert/);
  assert.match(res.text, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('switching to English shows English text, falls back to Chinese, and is remembered', async t => {
  const p = await portal(t);
  await createSite(p.pool, { name: '会议室', name_en: 'Meeting rooms', url: 'https://rooms.example.com', status: 'published' });
  await createSite(p.pool, { name: '仅中文', url: 'https://zh.example.com', status: 'published' });
  const browser = p.browser();
  assert.deepEqual(cardNames((await browser.get('/')).text), ['会议室', '仅中文']);
  const en = await browser.get('/?lang=en');
  assert.match(en.text, /<html lang="en"/);
  assert.deepEqual(cardNames(en.text), ['Meeting rooms', '仅中文']);
  assert.deepEqual(cardNames((await browser.get('/')).text), ['Meeting rooms', '仅中文'], 'language persists without the query parameter');
});

test('first-time visitors see English by default', async t => {
  const p = await portal(t);
  const res = await p.browser({ lang: null }).get('/');
  assert.match(res.text, /<html lang="en"/);
  assert.match(res.text, /Employee Portal/);
  assert.equal((await p.browser({ lang: null }).get('/api/portal')).json.settings.default_language, 'en');
});

test('an admin can make Chinese the default for first-time visitors', async t => {
  const p = await portal(t);
  await p.pool.query("UPDATE portal_settings SET default_language = 'zh'");
  const res = await p.browser({ lang: null }).get('/');
  assert.match(res.text, /<html lang="zh-CN"/);
  assert.match(res.text, /员工门户/);
});

test('search and category filters work without JavaScript and show an empty state', async t => {
  const p = await portal(t);
  const tools = await createCategory(p.pool, { name: '办公工具' });
  await createSite(p.pool, { name: 'IT HelpDesk', keywords: '报修, 电脑', url: 'https://helpdesk.example.com', status: 'published' });
  await createSite(p.pool, { name: '会议室', category_id: String(tools.id), url: 'https://rooms.example.com', status: 'published' });
  const browser = p.browser();
  assert.deepEqual(cardNames((await browser.get(`/?q=${encodeURIComponent('电脑')}`)).text), ['IT HelpDesk']);
  const byCategory = await browser.get(`/?category=${tools.id}`);
  assert.deepEqual(cardNames(byCategory.text), ['会议室']);
  assert.match(byCategory.text, /aria-pressed="true"[^>]*>办公工具</);
  const none = await browser.get('/?q=nothing-matches');
  assert.deepEqual(cardNames(none.text), []);
  assert.match(none.text, /没有找到匹配的网站/);
});

test('an empty catalog shows a friendly message', async t => {
  const p = await portal(t);
  const res = await p.browser().get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /还没有可用的网站/);
});

test('the portal API returns settings, visible categories and visible sites only', async t => {
  const p = await portal(t);
  const cat = await createCategory(p.pool, { name: 'IT' });
  await createSite(p.pool, { name: 'Live', url: 'https://live.example.com', category_id: String(cat.id), status: 'published' });
  await createSite(p.pool, { name: 'Draft', url: 'https://draft.example.com', status: 'draft' });
  const res = await p.browser().get('/api/portal');
  assert.equal(res.status, 200);
  assert.equal(res.json.settings.title_en, 'Employee Portal');
  assert.deepEqual(res.json.categories.map(c => c.name), ['IT']);
  assert.deepEqual(res.json.sites.map(s => s.name), ['Live']);
  assert.doesNotMatch(res.text, /created_by|updated_by|password/);
});

test('uploaded icons are served as images with nosniff; unknown files are 404', async t => {
  const p = await portal(t);
  const media = await saveMedia(p.pool, p.dataDir, PNG, null);
  await createSite(p.pool, { name: 'Pic', url: 'https://pic.example.com', media_id: media.id, status: 'published' });
  const browser = p.browser();
  assert.match((await browser.get('/')).text, new RegExp(`<img[^>]+src="/media/${media.filename}"`));
  const image = await fetch(`${p.url}/media/${media.filename}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${p.url}/media/00000000-0000-4000-8000-000000000000.png`)).status, 404);
  assert.equal((await fetch(`${p.url}/media/..%2F..%2Fpackage.json`)).status, 404);
});

test('a database outage shows a friendly 503 page instead of an error dump', async t => {
  const p = await startPortal();
  t.after(async () => { await p.close().catch(() => {}); });
  await p.pool.end();
  p.pool.end = async () => {};
  const res = await p.browser().get('/');
  assert.equal(res.status, 503);
  assert.match(res.text, /服务暂时不可用/);
  assert.doesNotMatch(res.text, /at .*\.js|Cannot use a pool/);
});
