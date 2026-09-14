import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, PASSWORD } from './helpers.js';
import { authenticate, createAdmin, findActiveAdmin, resetPassword, setAdminActive } from '../src/services/admins.js';

async function db(t) {
  const pool = await freshDatabase();
  t.after(() => pool.end());
  return pool;
}

test('an admin authenticates with a case-insensitive email and correct password', async t => {
  const pool = await db(t);
  const created = await createAdmin(pool, { name: 'Ada', email: ' Ada@Example.com ', password: PASSWORD });
  assert.equal(created.email, 'ada@example.com');
  assert.equal((await authenticate(pool, 'ADA@example.com', PASSWORD)).id, created.id);
  assert.equal(await authenticate(pool, 'ada@example.com', 'wrong password here'), null);
  assert.equal(await authenticate(pool, 'nobody@example.com', PASSWORD), null);
});

test('the returned admin never includes the password hash', async t => {
  const pool = await db(t);
  const created = await createAdmin(pool, { name: 'Ada', email: 'ada@example.com', password: PASSWORD });
  assert.equal('password_hash' in created, false);
  assert.equal('password_hash' in await authenticate(pool, 'ada@example.com', PASSWORD), false);
});

test('rejects duplicate emails and invalid input', async t => {
  const pool = await db(t);
  await createAdmin(pool, { name: 'Ada', email: 'ada@example.com', password: PASSWORD });
  await assert.rejects(createAdmin(pool, { name: 'Ada 2', email: 'ADA@example.com', password: PASSWORD }), /already exists/);
  await assert.rejects(createAdmin(pool, { name: '', email: 'b@example.com', password: PASSWORD }), /Name/);
  await assert.rejects(createAdmin(pool, { name: 'B', email: 'not-an-email', password: PASSWORD }), /email/i);
  await assert.rejects(createAdmin(pool, { name: 'B', email: 'b@example.com', password: 'short' }), /12–128/);
});

test('a deactivated admin can no longer authenticate or use an existing session', async t => {
  const pool = await db(t);
  const { id } = await createAdmin(pool, { name: 'Ada', email: 'ada@example.com', password: PASSWORD });
  assert.equal((await findActiveAdmin(pool, id)).id, id);
  assert.equal(await setAdminActive(pool, 'ada@example.com', false), true);
  assert.equal(await authenticate(pool, 'ada@example.com', PASSWORD), null);
  assert.equal(await findActiveAdmin(pool, id), null);
  await setAdminActive(pool, 'ada@example.com', true);
  assert.equal((await findActiveAdmin(pool, id)).id, id);
});

test('resetting a password replaces the old one', async t => {
  const pool = await db(t);
  await createAdmin(pool, { name: 'Ada', email: 'ada@example.com', password: PASSWORD });
  assert.equal(await resetPassword(pool, 'ada@example.com', 'a brand new password'), true);
  assert.equal(await authenticate(pool, 'ada@example.com', PASSWORD), null);
  assert.ok(await authenticate(pool, 'ada@example.com', 'a brand new password'));
  assert.equal(await resetPassword(pool, 'missing@example.com', 'a brand new password'), false);
});
