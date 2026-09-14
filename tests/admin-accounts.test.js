import test from 'node:test';
import assert from 'node:assert/strict';
import { startPortal, PASSWORD } from './helpers.js';
import { authenticate, createAdmin } from '../src/services/admins.js';

const NEW_PASSWORD = 'another long password';

async function signedIn(t) {
  const p = await startPortal();
  t.after(() => p.close());
  const me = await p.admin('me@example.com', 'Me');
  const browser = p.browser();
  await browser.login('me@example.com');
  return { p, browser, me };
}

const rowFor = (html, email) => html.match(new RegExp(`<tr[^>]*data-admin="[^"]*">(?:(?!</tr>)[\\s\\S])*${email.replace('.', '\\.')}[\\s\\S]*?</tr>`))?.[0] ?? '';

test('the admins page lists every admin with status and never shows password hashes', async t => {
  const { p, browser } = await signedIn(t);
  await createAdmin(p.pool, { name: 'Colleague', email: 'colleague@example.com', password: PASSWORD });
  const page = await browser.get('/admin/admins');
  assert.equal(page.status, 200);
  assert.match(page.text, /href="\/admin\/admins"[^>]*aria-current="page"/);
  assert.match(rowFor(page.text, 'colleague@example.com'), /启用中/);
  assert.match(rowFor(page.text, 'me@example.com'), /（你）/);
  assert.doesNotMatch(page.text, /scrypt:/);
});

test('an admin can add a colleague who can then sign in', async t => {
  const { p, browser } = await signedIn(t);
  await browser.get('/admin/admins');
  const res = await browser.post('/admin/admins', { name: '同事', email: 'New.Person@Example.com', password: PASSWORD, password_confirm: PASSWORD });
  assert.equal(res.status, 303);
  assert.match((await browser.get(res.location)).text, /已添加管理员/);
  assert.ok(await authenticate(p.pool, 'new.person@example.com', PASSWORD));
  const colleague = p.browser();
  assert.equal((await colleague.login('new.person@example.com')).status, 303);
});

test('adding an admin reports invalid input, keeps name and email but never echoes the password', async t => {
  const { p, browser } = await signedIn(t);
  await browser.get('/admin/admins');
  const short = await browser.post('/admin/admins', { name: '同事', email: 'c@example.com', password: '123456', password_confirm: '123456' });
  assert.equal(short.status, 422);
  assert.match(short.text, /密码需为 12–128 个字符/);
  assert.match(short.text, /value="同事"/);
  assert.match(short.text, /value="c@example.com"/);
  assert.doesNotMatch(short.text, /value="123456"/);
  const mismatch = await browser.post('/admin/admins', { name: '同事', email: 'c@example.com', password: PASSWORD, password_confirm: 'something else entirely' });
  assert.equal(mismatch.status, 422);
  assert.match(mismatch.text, /两次输入的密码不一致/);
  const duplicate = await browser.post('/admin/admins', { name: 'Dup', email: 'ME@example.com', password: PASSWORD, password_confirm: PASSWORD });
  assert.equal(duplicate.status, 422);
  assert.match(duplicate.text, /该邮箱已是管理员/);
  const invalid = await browser.post('/admin/admins', { name: '', email: 'not-an-email', password: PASSWORD, password_confirm: PASSWORD });
  assert.equal(invalid.status, 422);
  assert.match(invalid.text, /请填写姓名/);
  assert.match(invalid.text, /请输入有效的邮箱地址/);
  assert.equal((await p.pool.query('SELECT count(*)::int AS n FROM admins')).rows[0].n, 1);
});

test('deactivating a colleague ends their session and blocks sign-in until restored', async t => {
  const { p, browser } = await signedIn(t);
  const colleague = await createAdmin(p.pool, { name: 'Colleague', email: 'colleague@example.com', password: PASSWORD });
  const theirBrowser = p.browser();
  await theirBrowser.login('colleague@example.com');
  assert.equal((await theirBrowser.get('/admin/sites')).status, 200);
  await browser.get('/admin/admins');
  assert.equal((await browser.post(`/admin/admins/${colleague.id}/active`, { active: '0' })).status, 303);
  assert.equal((await theirBrowser.get('/admin/sites')).location, '/admin/login');
  assert.equal(await authenticate(p.pool, 'colleague@example.com', PASSWORD), null);
  assert.match(rowFor((await browser.get('/admin/admins')).text, 'colleague@example.com'), /已停用/);
  await browser.post(`/admin/admins/${colleague.id}/active`, { active: '1' });
  assert.ok(await authenticate(p.pool, 'colleague@example.com', PASSWORD));
});

test('an admin cannot deactivate their own account', async t => {
  const { p, browser, me } = await signedIn(t);
  await browser.get('/admin/admins');
  const res = await browser.post(`/admin/admins/${me.id}/active`, { active: '0' });
  assert.equal(res.status, 303);
  assert.match((await browser.get(res.location)).text, /不能停用自己的账号/);
  assert.ok(await authenticate(p.pool, 'me@example.com', PASSWORD));
});

test('resetting a colleague password replaces it and ends their sessions', async t => {
  const { p, browser } = await signedIn(t);
  const colleague = await createAdmin(p.pool, { name: 'Colleague', email: 'colleague@example.com', password: PASSWORD });
  const theirBrowser = p.browser();
  await theirBrowser.login('colleague@example.com');
  await browser.get('/admin/admins');
  const res = await browser.post(`/admin/admins/${colleague.id}/password`, { password: NEW_PASSWORD, password_confirm: NEW_PASSWORD });
  assert.equal(res.status, 303);
  assert.match((await browser.get(res.location)).text, /密码已重置/);
  assert.equal(await authenticate(p.pool, 'colleague@example.com', PASSWORD), null);
  assert.ok(await authenticate(p.pool, 'colleague@example.com', NEW_PASSWORD));
  assert.equal((await theirBrowser.get('/admin/sites')).location, '/admin/login');
  assert.equal((await browser.get('/admin/sites')).status, 200, 'the admin who reset it stays signed in');
});

test('a password reset with an invalid password is reported and changes nothing', async t => {
  const { p, browser } = await signedIn(t);
  const colleague = await createAdmin(p.pool, { name: 'Colleague', email: 'colleague@example.com', password: PASSWORD });
  await browser.get('/admin/admins');
  const res = await browser.post(`/admin/admins/${colleague.id}/password`, { password: 'short', password_confirm: 'short' });
  assert.match((await browser.get(res.location)).text, /密码需为 12–128 个字符/);
  assert.ok(await authenticate(p.pool, 'colleague@example.com', PASSWORD));
});

test('changing your own password needs the current one and signs out your other sessions', async t => {
  const { p, browser } = await signedIn(t);
  const otherDevice = p.browser();
  await otherDevice.login('me@example.com');
  assert.match((await browser.get('/admin/account')).text, /me@example\.com/);

  const wrong = await browser.post('/admin/account/password', { current_password: 'not my password!', password: NEW_PASSWORD, password_confirm: NEW_PASSWORD });
  assert.equal(wrong.status, 422);
  assert.match(wrong.text, /当前密码不正确/);
  const mismatch = await browser.post('/admin/account/password', { current_password: PASSWORD, password: NEW_PASSWORD, password_confirm: 'different long text' });
  assert.equal(mismatch.status, 422);
  assert.match(mismatch.text, /两次输入的密码不一致/);
  assert.ok(await authenticate(p.pool, 'me@example.com', PASSWORD));

  const ok = await browser.post('/admin/account/password', { current_password: PASSWORD, password: NEW_PASSWORD, password_confirm: NEW_PASSWORD });
  assert.equal(ok.status, 303);
  assert.match((await browser.get(ok.location)).text, /密码已修改/);
  assert.equal((await browser.get('/admin/sites')).status, 200, 'this session continues');
  assert.equal((await otherDevice.get('/admin/sites')).location, '/admin/login', 'other sessions end');
  assert.ok(await authenticate(p.pool, 'me@example.com', NEW_PASSWORD));
});

test('unknown admin ids return 404', async t => {
  const { browser } = await signedIn(t);
  await browser.get('/admin/admins');
  assert.equal((await browser.post('/admin/admins/999999/active', { active: '0' })).status, 404);
  assert.equal((await browser.post('/admin/admins/abc/password', { password: NEW_PASSWORD, password_confirm: NEW_PASSWORD })).status, 404);
});

test('signed-out visitors cannot manage admins', async t => {
  const p = await startPortal();
  t.after(() => p.close());
  const victim = await createAdmin(p.pool, { name: 'Victim', email: 'victim@example.com', password: PASSWORD });
  const browser = p.browser();
  await browser.get('/admin/login');
  for (const [path, fields] of [
    ['/admin/admins', { name: 'x', email: 'x@example.com', password: PASSWORD, password_confirm: PASSWORD }],
    [`/admin/admins/${victim.id}/active`, { active: '0' }],
    [`/admin/admins/${victim.id}/password`, { password: NEW_PASSWORD, password_confirm: NEW_PASSWORD }],
    ['/admin/account/password', { current_password: PASSWORD, password: NEW_PASSWORD, password_confirm: NEW_PASSWORD }],
  ]) assert.equal((await browser.post(path, fields)).status, 302, path);
  assert.equal((await p.pool.query('SELECT count(*)::int AS n FROM admins')).rows[0].n, 1);
  assert.ok(await authenticate(p.pool, 'victim@example.com', PASSWORD));
});
