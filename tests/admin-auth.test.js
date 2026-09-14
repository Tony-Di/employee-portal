import test from 'node:test';
import assert from 'node:assert/strict';
import { startPortal, PASSWORD } from './helpers.js';
import { setAdminActive } from '../src/services/admins.js';

async function portal(t, overrides) {
  const p = await startPortal(overrides);
  t.after(() => p.close());
  return p;
}

test('admin pages redirect to login and admin APIs return 401 when signed out', async t => {
  const p = await portal(t);
  const browser = p.browser();
  const page = await browser.get('/admin/sites');
  assert.equal(page.status, 302);
  assert.equal(page.location, '/admin/login');
  const api = await browser.get('/api/admin/me');
  assert.equal(api.status, 401);
  assert.equal(api.json.error, 'unauthenticated');
});

test('signing in with the correct password opens the admin console', async t => {
  const p = await portal(t);
  await p.admin();
  const browser = p.browser();
  await browser.get('/admin/login');
  const before = browser.cookies.get('portal.sid');
  const res = await browser.post('/admin/login', { email: 'ADMIN@example.com', password: PASSWORD });
  assert.equal(res.status, 303);
  assert.equal(res.location, '/admin/sites');
  assert.notEqual(browser.cookies.get('portal.sid'), before, 'session id must change on login');
  const cookie = res.headers.getSetCookie().find(c => c.startsWith('portal.sid='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const me = await browser.get('/api/admin/me');
  assert.equal(me.status, 200);
  assert.deepEqual(Object.keys(me.json.admin).sort(), ['email', 'id', 'name']);
  assert.equal(me.json.admin.email, 'admin@example.com');
  assert.equal((await browser.get('/admin/sites')).status, 200);
});

test('a wrong password shows an error, keeps the email and grants no access', async t => {
  const p = await portal(t);
  await p.admin();
  const browser = p.browser();
  const res = await browser.login('admin@example.com', 'not the password');
  assert.equal(res.status, 401);
  assert.match(res.text, /邮箱或密码不正确/);
  assert.match(res.text, /value="admin@example.com"/);
  assert.equal((await browser.get('/api/admin/me')).status, 401);
});

test('login without a valid CSRF token is rejected', async t => {
  const p = await portal(t);
  await p.admin();
  const browser = p.browser();
  await browser.get('/admin/login');
  browser.csrf = 'a'.repeat(64);
  const res = await browser.post('/admin/login', { email: 'admin@example.com', password: PASSWORD });
  assert.equal(res.status, 403);
  assert.equal((await browser.get('/api/admin/me')).status, 401);
});

test('logging out ends the session', async t => {
  const p = await portal(t);
  await p.admin();
  const browser = p.browser();
  await browser.login();
  await browser.get('/admin/sites');
  const res = await browser.post('/admin/logout');
  assert.equal(res.status, 303);
  assert.equal(res.location, '/admin/login');
  assert.equal((await browser.get('/api/admin/me')).status, 401);
  assert.equal((await p.pool.query('SELECT count(*)::int AS n FROM sessions WHERE sess::text LIKE \'%adminId%\'')).rows[0].n, 0);
});

test('deactivating an admin revokes their existing session', async t => {
  const p = await portal(t);
  await p.admin();
  const browser = p.browser();
  await browser.login();
  assert.equal((await browser.get('/api/admin/me')).status, 200);
  await setAdminActive(p.pool, 'admin@example.com', false);
  assert.equal((await browser.get('/api/admin/me')).status, 401);
  assert.equal((await browser.get('/admin/sites')).location, '/admin/login');
});

test('repeated failed logins are rate limited', async t => {
  const p = await portal(t, { loginAttempts: 3 });
  await p.admin();
  const browser = p.browser();
  for (let i = 0; i < 3; i++) assert.equal((await browser.login('admin@example.com', 'wrong password!')).status, 401);
  const blocked = await browser.login('admin@example.com', PASSWORD);
  assert.equal(blocked.status, 429);
  assert.equal((await browser.get('/api/admin/me')).status, 401);
});

test('with no admin accounts yet, the login page explains how to create the first one', async t => {
  const p = await portal(t);
  const empty = await p.browser({ lang: null }).get('/admin/login');
  assert.match(empty.text, /No admin account exists yet/);
  assert.match(empty.text, /npm run admin -- create/);
  await p.admin();
  const after = await p.browser({ lang: null }).get('/admin/login');
  assert.doesNotMatch(after.text, /No admin account exists yet|npm run admin/);
});
