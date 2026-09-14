import { transaction } from '../db.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { parseId } from './input.js';

const TABLES = new Set(['sites', 'categories']);

function table(name) {
  if (!TABLES.has(name)) throw new Error(`Unsupported ordered table ${name}`);
  return name;
}

async function lockedIds(client, name) {
  await client.query(`LOCK TABLE ${table(name)} IN SHARE ROW EXCLUSIVE MODE`);
  return (await client.query(`SELECT id FROM ${name} ORDER BY sort_order, id`)).rows.map(r => r.id);
}

async function writeOrder(client, name, ids) {
  await client.query(
    `UPDATE ${table(name)} SET sort_order = o.position FROM unnest($1::int[]) WITH ORDINALITY AS o(id, position) WHERE ${name}.id = o.id`, [ids]);
}

export async function nextSortOrder(client, name) {
  await client.query(`LOCK TABLE ${table(name)} IN SHARE ROW EXCLUSIVE MODE`);
  return (await client.query(`SELECT coalesce(max(sort_order) + 1, 0) AS n FROM ${name}`)).rows[0].n;
}

// Swaps a row with its neighbour; moving past either end is a no-op.
export function moveRow(pool, name, id, direction) {
  return transaction(pool, async client => {
    const ids = await lockedIds(client, name);
    const index = ids.indexOf(parseId(id));
    if (index < 0) throw new NotFoundError();
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await writeOrder(client, name, ids);
  });
}

// Accepts a complete permutation of the current ids, so a stale page cannot drop rows from the order.
export function reorderRows(pool, name, order) {
  return transaction(pool, async client => {
    const ids = await lockedIds(client, name);
    const requested = Array.isArray(order) ? order.map(Number) : [];
    const complete = requested.length === ids.length && new Set(requested).size === ids.length && ids.every(i => requested.includes(i));
    if (!complete) throw new ValidationError({ order: ['排序已过期，请刷新页面后重试。', 'The order is out of date. Reload and try again.'] });
    await writeOrder(client, name, requested);
  });
}
