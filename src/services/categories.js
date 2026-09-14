import { transaction } from '../db.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { maxLength, parseId, text } from './input.js';
import { moveRow, nextSortOrder, reorderRows } from './ordering.js';

function normalize(input) {
  const values = { name: text(input.name), name_en: text(input.name_en) };
  const errors = {};
  if (!values.name && !values.name_en) errors.name = ['请至少填写中文或英文分类名称。', 'Enter a category name in at least one language.'];
  maxLength(errors, values, { name: 80, name_en: 80 });
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return values;
}

export async function listCategories(db) {
  return (await db.query(
    `SELECT c.*, (SELECT count(*)::int FROM sites s WHERE s.category_id = c.id) AS site_count
     FROM categories c ORDER BY c.sort_order, c.id`)).rows;
}

export async function getCategory(db, id) {
  const { rows } = await db.query('SELECT * FROM categories WHERE id = $1', [parseId(id)]);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function createCategory(pool, input) {
  const v = normalize(input);
  return transaction(pool, async client => {
    const sortOrder = await nextSortOrder(client, 'categories');
    return (await client.query('INSERT INTO categories(name, name_en, sort_order) VALUES ($1, $2, $3) RETURNING *', [v.name, v.name_en, sortOrder])).rows[0];
  });
}

export async function updateCategory(pool, id, input) {
  const current = await getCategory(pool, id);
  const v = normalize({ name: input.name ?? current.name, name_en: input.name_en ?? current.name_en });
  return (await pool.query('UPDATE categories SET name = $1, name_en = $2 WHERE id = $3 RETURNING *', [v.name, v.name_en, current.id])).rows[0];
}

export async function deleteCategory(pool, id) {
  const categoryId = parseId(id);
  try {
    const { rowCount } = await pool.query('DELETE FROM categories WHERE id = $1', [categoryId]);
    if (!rowCount) throw new NotFoundError();
  } catch (error) {
    // sites.category_id is ON DELETE RESTRICT, so the database is the source of truth for "in use".
    if (error.code === '23503') throw new ConflictError(['该分类下还有网站，请先把这些网站移到其他分类。', 'Sites still use this category. Move them to another category first.']);
    throw error;
  }
}

export const moveCategory = (pool, id, direction) => moveRow(pool, 'categories', id, direction);
export const reorderCategories = (pool, ids) => reorderRows(pool, 'categories', ids);
