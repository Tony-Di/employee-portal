import { transaction } from '../db.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { ICONS } from '../icons.js';
import { bool, last, likePattern, maxLength, mediaExists, parseId, text } from './input.js';
import { moveRow, nextSortOrder, reorderRows } from './ordering.js';

export const STATUSES = ['draft', 'published', 'hidden', 'placeholder'];
const FIELDS = ['name', 'name_en', 'description', 'description_en', 'url', 'icon_key', 'media_id', 'category_id', 'keywords', 'open_in_new_tab', 'status'];
const SELECT = `SELECT s.*, c.name AS category_name, c.name_en AS category_name_en, m.filename AS media_filename
  FROM sites s LEFT JOIN categories c ON c.id = s.category_id LEFT JOIN media m ON m.id = s.media_id`;

export function validUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch { return false; }
}

async function normalize(db, input) {
  const values = {
    name: text(input.name), name_en: text(input.name_en),
    description: text(input.description), description_en: text(input.description_en),
    url: text(input.url) || null,
    icon_key: text(input.icon_key) || 'globe',
    media_id: text(input.media_id) || null,
    category_id: text(input.category_id) || null,
    keywords: text(input.keywords),
    open_in_new_tab: input.open_in_new_tab === undefined ? true : bool(input.open_in_new_tab),
    status: text(input.status) || 'draft',
  };
  const errors = {};
  if (!values.name && !values.name_en) errors.name = ['请至少填写中文或英文名称。', 'Enter a name in at least one language.'];
  maxLength(errors, values, { name: 100, name_en: 100, description: 240, description_en: 240, keywords: 300 });
  if (values.url && (values.url.length > 2048 || !validUrl(values.url))) {
    errors.url = ['请输入以 http:// 或 https:// 开头的有效网址。', 'Enter a valid address starting with http:// or https://.'];
  }
  if (!STATUSES.includes(values.status)) errors.status = ['状态无效。', 'Invalid status.'];
  if (values.status === 'published' && !values.url) {
    errors.url ??= ['发布前请填写网站地址；暂时没有地址可保存为占位。', 'Add an address before publishing, or save it as a placeholder.'];
  }
  if (!Object.hasOwn(ICONS, values.icon_key)) errors.icon_key = ['请选择有效的图标。', 'Choose a valid icon.'];
  if (values.category_id !== null) {
    const id = Number(values.category_id);
    const exists = Number.isInteger(id) && id > 0 && (await db.query('SELECT 1 FROM categories WHERE id = $1', [id])).rowCount;
    if (exists) values.category_id = id;
    else errors.category_id = ['分类不存在，请重新选择。', 'That category no longer exists.'];
  }
  if (values.media_id !== null && !(await mediaExists(db, values.media_id))) {
    errors.media_id = ['上传的图标不存在，请重新上传。', 'The uploaded icon is missing. Upload it again.'];
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return values;
}

export async function getSite(db, id) {
  const { rows } = await db.query(`${SELECT} WHERE s.id = $1`, [parseId(id)]);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function listSites(db, { q = '', status = '' } = {}) {
  const where = [];
  const params = [];
  if (STATUSES.includes(status)) { params.push(status); where.push(`s.status = $${params.length}`); }
  if (String(q).trim()) {
    params.push(likePattern(String(q).trim()));
    where.push(`concat_ws(' ', s.name, s.name_en, s.description, s.description_en, s.keywords, s.url) ILIKE $${params.length}`);
  }
  const { rows } = await db.query(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.sort_order, s.id`, params);
  return rows;
}

export async function createSite(pool, input, adminId = null) {
  return transaction(pool, async client => {
    const v = await normalize(client, input);
    const sortOrder = await nextSortOrder(client, 'sites');
    const { rows } = await client.query(
      `INSERT INTO sites(${FIELDS.join(', ')}, sort_order, created_by, updated_by)
       VALUES (${FIELDS.map((_, i) => `$${i + 1}`).join(', ')}, $${FIELDS.length + 1}, $${FIELDS.length + 2}, $${FIELDS.length + 2})
       RETURNING id`, [...FIELDS.map(f => v[f]), sortOrder, adminId]);
    return getSite(client, rows[0].id);
  });
}

// Fields missing from input keep their saved value, so JSON clients can send partial updates.
export async function updateSite(pool, id, input, adminId = null) {
  return transaction(pool, async client => {
    // Read the version and merge partial edits only after earlier writers finish.
    await client.query('SELECT 1 FROM sites WHERE id = $1 FOR UPDATE', [parseId(id)]);
    const current = await getSite(client, id);
    if (input.version !== undefined && Number(last(input.version)) !== current.version) {
      throw new ConflictError(['该网站已被其他管理员修改，请刷新后再编辑。', 'Someone else changed this site. Reload it before editing.']);
    }
    const v = await normalize(client, Object.fromEntries(FIELDS.map(f => [f, input[f] === undefined ? current[f] : input[f]])));
    await client.query(
      `UPDATE sites SET ${FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ')}, updated_by = $${FIELDS.length + 1},
       updated_at = now(), version = version + 1 WHERE id = $${FIELDS.length + 2}`,
      [...FIELDS.map(f => v[f]), adminId, current.id]);
    return getSite(client, current.id);
  });
}

export const setSiteStatus = (pool, id, status, adminId = null) => updateSite(pool, id, { status }, adminId);
export const moveSite = (pool, id, direction) => moveRow(pool, 'sites', id, direction);
export const reorderSites = (pool, ids) => reorderRows(pool, 'sites', ids);
