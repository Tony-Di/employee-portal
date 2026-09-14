import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { freshDatabase, PNG } from './helpers.js';
import { saveMedia } from '../src/services/media.js';
import { ValidationError } from '../src/errors.js';

async function setup(t) {
  const pool = await freshDatabase();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'portal-media-'));
  t.after(async () => { await pool.end(); await rm(dataDir, { recursive: true, force: true }); });
  return { pool, dataDir };
}

test('stores a real PNG under a random name and records it', async t => {
  const { pool, dataDir } = await setup(t);
  const media = await saveMedia(pool, dataDir, PNG, null);
  assert.match(media.filename, /^[0-9a-f-]{36}\.png$/);
  assert.equal(media.url, `/media/${media.filename}`);
  assert.deepEqual(await readFile(path.join(dataDir, 'uploads', media.filename)), PNG);
  const row = (await pool.query('SELECT mime_type FROM media WHERE id = $1', [media.id])).rows[0];
  assert.equal(row.mime_type, 'image/png');
});

test('rejects files whose content is not PNG, JPEG or WebP, whatever they claim to be', async t => {
  const { pool, dataDir } = await setup(t);
  const samples = [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
    Buffer.from('<html><script>alert(1)</script></html>'),
    Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'latin1'),
    Buffer.alloc(0),
  ];
  for (const sample of samples) await assert.rejects(saveMedia(pool, dataDir, sample, null), ValidationError);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM media')).rows[0].n, 0);
  assert.deepEqual(await readdir(path.join(dataDir, 'uploads')).catch(() => []), []);
});

test('rejects images larger than 2 MB', async t => {
  const { pool, dataDir } = await setup(t);
  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
  await assert.rejects(saveMedia(pool, dataDir, big, null), ValidationError);
});
