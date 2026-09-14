import { transaction } from '../db.js';
import { ConflictError, ValidationError } from '../errors.js';
import { last, maxLength, mediaExists, text } from './input.js';
import { getSettings } from './portal.js';

const FIELDS = ['title', 'title_en', 'description', 'description_en', 'logo_id', 'default_language'];

export async function updateSettings(pool, input, adminId = null) {
  return transaction(pool, async client => {
    const current = (await client.query('SELECT * FROM portal_settings WHERE id = 1 FOR UPDATE')).rows[0];
    if (input.version !== undefined && Number(last(input.version)) !== current.version) {
      throw new ConflictError(['门户设置已被其他管理员修改，请刷新后再编辑。', 'Someone else changed the settings. Reload before editing.']);
    }
    const pick = field => (input[field] === undefined ? current[field] : input[field]);
    const values = Object.fromEntries(FIELDS.map(f => [f, text(pick(f))]));
    values.logo_id ||= null;
    const errors = {};
    if (!values.title && !values.title_en) errors.title = ['请至少填写中文或英文门户名称。', 'Enter a portal title in at least one language.'];
    maxLength(errors, values, { title: 80, title_en: 80, description: 200, description_en: 200 });
    if (!['zh', 'en'].includes(values.default_language)) errors.default_language = ['默认语言无效。', 'Invalid default language.'];
    if (values.logo_id && !(await mediaExists(client, values.logo_id))) errors.logo_id = ['Logo 文件不存在，请重新上传。', 'The logo file is missing. Upload it again.'];
    if (Object.keys(errors).length) throw new ValidationError(errors);
    await client.query(
      `UPDATE portal_settings SET ${FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ')}, updated_by = $${FIELDS.length + 1},
       updated_at = now(), version = version + 1 WHERE id = 1`, [...FIELDS.map(f => values[f]), adminId]);
    return getSettings(client);
  });
}
