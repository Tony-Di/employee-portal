import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase } from './helpers.js';
import { createCategory, deleteCategory, listCategories, moveCategory, reorderCategories, updateCategory } from '../src/services/categories.js';
import { updateSettings } from '../src/services/settings.js';
import { createSite } from '../src/services/sites.js';
import { getSettings, publicCatalog } from '../src/services/portal.js';
import { ConflictError, ValidationError } from '../src/errors.js';

async function db(t) {
  const pool = await freshDatabase();
  await pool.query('DELETE FROM sites; DELETE FROM categories;');
  t.after(() => pool.end());
  return pool;
}

const fieldsOf = async promise => {
  const error = await promise.then(() => null, e => e);
  assert.ok(error instanceof ValidationError, `expected ValidationError, got ${error}`);
  return Object.keys(error.errors).sort();
};

test('categories need a name in one language and are listed with site counts in order', async t => {
  const pool = await db(t);
  assert.deepEqual(await fieldsOf(createCategory(pool, { name: '', name_en: ' ' })), ['name']);
  assert.deepEqual(await fieldsOf(createCategory(pool, { name: 'x'.repeat(81) })), ['name']);
  const office = await createCategory(pool, { name: '办公' });
  const it = await createCategory(pool, { name_en: 'IT' });
  await createSite(pool, { name: 'Mail', category_id: String(it.id), status: 'draft' });
  const list = await listCategories(pool);
  assert.deepEqual(list.map(c => [c.name || c.name_en, c.site_count]), [['办公', 0], ['IT', 1]]);
  await updateCategory(pool, office.id, { name: '办公工具', name_en: 'Office' });
  assert.equal((await listCategories(pool))[0].name_en, 'Office');
});

test('a category in use cannot be deleted; an empty one can', async t => {
  const pool = await db(t);
  const used = await createCategory(pool, { name: '使用中' });
  const empty = await createCategory(pool, { name: '空分类' });
  await createSite(pool, { name: 'A', category_id: String(used.id), status: 'draft' });
  await assert.rejects(deleteCategory(pool, used.id), ConflictError);
  await deleteCategory(pool, empty.id);
  assert.deepEqual((await listCategories(pool)).map(c => c.name), ['使用中']);
});

test('categories can be moved and reordered', async t => {
  const pool = await db(t);
  const ids = [];
  for (const name of ['A', 'B', 'C']) ids.push((await createCategory(pool, { name })).id);
  await moveCategory(pool, ids[0], 'down');
  assert.deepEqual((await listCategories(pool)).map(c => c.name), ['B', 'A', 'C']);
  await reorderCategories(pool, [ids[2], ids[0], ids[1]]);
  assert.deepEqual((await listCategories(pool)).map(c => c.name), ['C', 'A', 'B']);
  assert.deepEqual(await fieldsOf(reorderCategories(pool, [ids[2]])), ['order']);
});

test('the public catalog only lists categories that contain visible sites', async t => {
  const pool = await db(t);
  const shown = await createCategory(pool, { name: '可见' });
  const draftOnly = await createCategory(pool, { name: '只有草稿' });
  await createCategory(pool, { name: '空' });
  await createSite(pool, { name: 'Live', url: 'https://live.example.com', category_id: String(shown.id), status: 'published' });
  await createSite(pool, { name: 'Draft', category_id: String(draftOnly.id), status: 'draft' });
  assert.deepEqual((await publicCatalog(pool)).categories.map(c => c.name), ['可见']);
  assert.deepEqual((await publicCatalog(pool, { category: String(draftOnly.id) })).sites, []);
});

test('portal settings validate titles and language and detect stale edits', async t => {
  const pool = await db(t);
  const current = await getSettings(pool);
  assert.deepEqual(await fieldsOf(updateSettings(pool, { title: '', title_en: '', version: current.version })), ['title']);
  assert.deepEqual(await fieldsOf(updateSettings(pool, { title: 'A', default_language: 'fr', version: current.version })), ['default_language']);
  assert.deepEqual(await fieldsOf(updateSettings(pool, { title: 'A', description: 'x'.repeat(201), version: current.version })), ['description']);
  const saved = await updateSettings(pool, { title: 'SEG 门户', title_en: 'SEG Portal', description: '', description_en: 'Start here', default_language: 'en', version: current.version });
  assert.equal(saved.version, current.version + 1);
  const { settings } = await publicCatalog(pool);
  assert.deepEqual([settings.title, settings.title_en, settings.description_en, settings.default_language], ['SEG 门户', 'SEG Portal', 'Start here', 'en']);
  await assert.rejects(updateSettings(pool, { title: 'Late', version: current.version }), ConflictError);
  assert.equal((await getSettings(pool)).title, 'SEG 门户');
});
