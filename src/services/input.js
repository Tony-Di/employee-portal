import { NotFoundError } from '../errors.js';

// Repeated form fields (hidden input + checkbox) arrive as arrays; the last value wins.
export const last = value => (Array.isArray(value) ? value.at(-1) : value);
export const text = value => String(last(value) ?? '').trim();
export const bool = value => last(value) === true || ['1', 'true', 'on', 'yes'].includes(String(last(value)).toLowerCase());
export const likePattern = q => `%${q.replace(/[\\%_]/g, '\\$&')}%`;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new NotFoundError();
  return n;
}

export function maxLength(errors, values, limits) {
  for (const [field, max] of Object.entries(limits)) {
    if (values[field].length > max) errors[field] ??= [`不能超过 ${max} 个字符。`, `Must be ${max} characters or fewer.`];
  }
}

export async function mediaExists(db, id) {
  return UUID.test(id) && (await db.query('SELECT 1 FROM media WHERE id = $1', [id])).rowCount === 1;
}
