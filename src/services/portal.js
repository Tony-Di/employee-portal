import { likePattern } from './input.js';

const mediaUrl = filename => (filename ? `/media/${filename}` : null);

export async function getSettings(db) {
  const { rows } = await db.query(
    'SELECT p.*, m.filename AS logo_filename FROM portal_settings p LEFT JOIN media m ON m.id = p.logo_id WHERE p.id = 1');
  return rows[0];
}

// Everything an employee may see: no drafts, hidden sites, admin ids or placeholder addresses.
export async function publicCatalog(db, { q = '', category = '' } = {}) {
  const settings = await getSettings(db);
  const params = [];
  const filters = [];
  const query = String(q).trim().slice(0, 100);
  if (query) {
    params.push(likePattern(query));
    filters.push(`concat_ws(' ', s.name, s.name_en, s.description, s.description_en, s.keywords) ILIKE $${params.length}`);
  }
  const categoryId = Number(category);
  if (Number.isInteger(categoryId) && categoryId > 0 && categoryId < 2 ** 31) { params.push(categoryId); filters.push(`s.category_id = $${params.length}`); }
  const visible = "s.status IN ('published', 'placeholder')";
  const sites = (await db.query(
    `SELECT s.id, s.name, s.name_en, s.description, s.description_en, s.icon_key, s.category_id, s.keywords,
            s.open_in_new_tab, s.status, CASE WHEN s.status = 'published' THEN s.url END AS url, m.filename AS media_filename
     FROM sites s LEFT JOIN media m ON m.id = s.media_id
     WHERE ${[visible, ...filters].join(' AND ')} ORDER BY s.sort_order, s.id`, params)).rows;
  const categories = (await db.query(
    `SELECT c.id, c.name, c.name_en FROM categories c
     WHERE EXISTS (SELECT 1 FROM sites s WHERE s.category_id = c.id AND ${visible}) ORDER BY c.sort_order, c.id`)).rows;
  return {
    settings: {
      title: settings.title, title_en: settings.title_en, description: settings.description, description_en: settings.description_en,
      logo_url: mediaUrl(settings.logo_filename), default_language: settings.default_language,
    },
    categories,
    sites: sites.map(({ media_filename, ...site }) => ({ ...site, icon_url: mediaUrl(media_filename) })),
  };
}
