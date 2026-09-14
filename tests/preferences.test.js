import test from 'node:test';
import assert from 'node:assert/strict';
import { startPortal } from './helpers.js';

async function portal(t) {
  const p = await startPortal();
  t.after(() => p.close());
  return p;
}

const htmlTag = html => html.match(/<html[^>]*>/)[0];
const decode = s => s.replaceAll('&amp;', '&');

test('without a saved choice the page follows the system theme and offers a toggle', async t => {
  const p = await portal(t);
  const res = await p.browser().get('/');
  assert.doesNotMatch(htmlTag(res.text), /data-theme/);
  assert.match(res.text, /data-theme-toggle/);
});

test('choosing dark or light mode is applied and remembered; unknown values are ignored', async t => {
  const p = await portal(t);
  const browser = p.browser();
  assert.match(htmlTag((await browser.get('/?theme=dark')).text), /data-theme="dark"/);
  assert.match(htmlTag((await browser.get('/')).text), /data-theme="dark"/);
  assert.match(htmlTag((await browser.get('/?theme=purple')).text), /data-theme="dark"/);
  assert.match(htmlTag((await browser.get('/?theme=light')).text), /data-theme="light"/);
  assert.match(htmlTag((await browser.get('/admin/login')).text), /data-theme="light"/);
});

test('the theme cookie is readable by the page script so the toggle works without reloading', async t => {
  const p = await portal(t);
  const res = await p.browser().get('/?theme=dark');
  const cookie = res.headers.getSetCookie().find(c => c.startsWith('portal_theme='));
  assert.match(cookie, /portal_theme=dark/);
  assert.doesNotMatch(cookie, /HttpOnly/i);
});

test('admin pages carry the theme and language controls', async t => {
  const p = await portal(t);
  await p.admin();
  const browser = p.browser();
  await browser.login();
  const page = await browser.get('/admin/sites?theme=dark&lang=en');
  assert.match(htmlTag(page.text), /lang="en"/);
  assert.match(htmlTag(page.text), /data-theme="dark"/);
  assert.match(page.text, /data-theme-toggle/);
  assert.match(page.text, />Sites</);
  assert.match((await p.browser().get('/admin/login?lang=en')).text, /Admin sign in/);
});

test('switch links keep the current search and category', async t => {
  const p = await portal(t);
  const html = (await p.browser().get('/?q=mail&category=7')).text;
  const langHref = decode(html.match(/<a class="lang-switch" href="([^"]+)"/)[1]);
  const themeHref = decode(html.match(/<a[^>]+data-theme-toggle[^>]*href="([^"]+)"|<a[^>]+href="([^"]+)"[^>]*data-theme-toggle/).slice(1).find(Boolean));
  for (const href of [langHref, themeHref]) {
    const params = new URLSearchParams(href.replace(/^[^?]*\?/, ''));
    assert.equal(params.get('q'), 'mail');
    assert.equal(params.get('category'), '7');
  }
  assert.equal(new URLSearchParams(langHref.split('?')[1]).get('lang'), 'en');
  assert.equal(new URLSearchParams(themeHref.split('?')[1]).get('theme'), 'dark');
});

test('an oversized form gets a friendly 413 page and malformed JSON a JSON error', async t => {
  const p = await portal(t);
  const big = await fetch(`${p.url}/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `email=${'a'.repeat(200 * 1024)}`,
  });
  assert.equal(big.status, 413);
  assert.match(await big.text(), /The submitted content is too large/);
  const bad = await fetch(`${p.url}/api/admin/sites`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'bad_request');
  assert.equal(p.errors.length, 0, 'client errors are not logged as server failures');
});
