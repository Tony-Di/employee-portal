import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/auth.js';

test('a hashed password verifies only with the original password', async () => {
  const stored = await hashPassword('correct horse battery');
  assert.match(stored, /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.equal(await verifyPassword('correct horse battery', stored), true);
  assert.equal(await verifyPassword('correct horse batterx', stored), false);
});

test('hashing the same password twice uses different salts', async () => {
  assert.notEqual(await hashPassword('correct horse battery'), await hashPassword('correct horse battery'));
});

test('rejects passwords outside 6–128 characters', async () => {
  await assert.rejects(hashPassword('short'), /6–128/);
  await assert.rejects(hashPassword('x'.repeat(129)), /6–128/);
  assert.equal(await verifyPassword('123456', await hashPassword('123456')), true);
});

test('malformed stored hashes never verify', async () => {
  for (const stored of ['', null, 'plain', 'bcrypt:aa:bb', `scrypt:${'a'.repeat(32)}:zz`]) {
    assert.equal(await verifyPassword('correct horse battery', stored), false);
  }
});
