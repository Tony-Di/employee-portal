import { hashPassword, verifyPassword } from '../auth.js';
import { transaction } from '../db.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { parseId } from './input.js';

const PUBLIC_FIELDS = 'id, name, email';
// Verified against when the email is unknown so both paths spend the same scrypt time.
const DUMMY_HASH = `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;

const MESSAGES = {
  name: ['请填写姓名（最多 100 个字符）。', 'Name must contain 1–100 characters.'],
  email: ['请输入有效的邮箱地址。', 'Enter a valid email address.'],
  duplicate: ['该邮箱已是管理员。', 'An admin with this email already exists.'],
  password: ['密码需为 12–128 个字符。', 'Password must contain 12–128 characters.'],
  mismatch: ['两次输入的密码不一致。', 'The passwords do not match.'],
  current: ['当前密码不正确。', 'The current password is incorrect.'],
  self: ['不能停用自己的账号。', 'You cannot deactivate your own account.'],
  last: ['至少要保留一个启用中的管理员。', 'At least one admin must stay active.'],
};

export const normalizeEmail = email => String(email ?? '').trim().toLowerCase();

// Checks a new password (and its confirmation, when the form sends one) and returns the hash.
async function newPasswordHash(errors, password, confirm) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    errors.password = MESSAGES.password;
    return null;
  }
  if (confirm !== undefined && confirm !== password) {
    errors.password = MESSAGES.mismatch;
    return null;
  }
  return hashPassword(password);
}

export async function createAdmin(pool, { name, email, password, password_confirm: confirm }) {
  name = String(name ?? '').trim();
  email = normalizeEmail(email);
  const errors = {};
  if (!name || name.length > 100) errors.name = MESSAGES.name;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = MESSAGES.email;
  const passwordHash = await newPasswordHash(errors, password, confirm);
  if (Object.keys(errors).length) throw new ValidationError(errors);
  try {
    const { rows } = await pool.query(
      `INSERT INTO admins(name, email, password_hash) VALUES ($1, $2, $3) RETURNING ${PUBLIC_FIELDS}`,
      [name, email, passwordHash]);
    return rows[0];
  } catch (error) {
    if (error.code === '23505') throw new ValidationError({ email: MESSAGES.duplicate });
    throw error;
  }
}

export async function authenticate(pool, email, password) {
  const { rows } = await pool.query(
    `SELECT ${PUBLIC_FIELDS}, password_hash, active, session_epoch FROM admins WHERE email = $1`, [normalizeEmail(email)]);
  const admin = rows[0];
  const valid = await verifyPassword(password, admin?.password_hash ?? DUMMY_HASH);
  if (!admin || !valid || !admin.active) return null;
  return { id: admin.id, name: admin.name, email: admin.email, session_epoch: admin.session_epoch };
}

export async function findActiveAdmin(pool, id) {
  if (!Number.isInteger(id)) return null;
  const { rows } = await pool.query(`SELECT ${PUBLIC_FIELDS}, session_epoch FROM admins WHERE id = $1 AND active`, [id]);
  return rows[0] ?? null;
}

export async function getAdmin(pool, id) {
  const { rows } = await pool.query(`SELECT ${PUBLIC_FIELDS}, active FROM admins WHERE id = $1`, [parseId(id)]);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function listAdmins(pool) {
  return (await pool.query(`SELECT ${PUBLIC_FIELDS}, active, created_at FROM admins ORDER BY active DESC, name, id`)).rows;
}

export async function hasAdmins(pool) {
  return (await pool.query('SELECT EXISTS (SELECT 1 FROM admins) AS any')).rows[0].any;
}

// Command-line helpers address admins by email and are not limited by the web console's guards.
export async function resetPassword(pool, email, password) {
  const passwordHash = await hashPassword(password);
  const { rowCount } = await pool.query(
    'UPDATE admins SET password_hash = $1, session_epoch = session_epoch + 1 WHERE email = $2', [passwordHash, normalizeEmail(email)]);
  return rowCount === 1;
}

export async function setAdminActive(pool, email, active) {
  const { rowCount } = await pool.query('UPDATE admins SET active = $1 WHERE email = $2', [active, normalizeEmail(email)]);
  return rowCount === 1;
}

export async function activateAdmin(pool, id) {
  const admin = await getAdmin(pool, id);
  await pool.query('UPDATE admins SET active = true WHERE id = $1', [admin.id]);
}

export async function deactivateAdmin(pool, id, actingAdminId) {
  const targetId = parseId(id);
  if (targetId === actingAdminId) throw new ConflictError(MESSAGES.self);
  return transaction(pool, async client => {
    // Locking every active admin serialises concurrent deactivations, so they cannot remove the last one.
    const active = (await client.query('SELECT id FROM admins WHERE active ORDER BY id FOR UPDATE')).rows.map(r => r.id);
    if (!active.includes(targetId)) {
      await getAdmin(client, targetId);
      return;
    }
    if (active.length <= 1) throw new ConflictError(MESSAGES.last);
    await client.query('UPDATE admins SET active = false WHERE id = $1', [targetId]);
  });
}

export async function resetAdminPassword(pool, id, { password, password_confirm: confirm }) {
  const admin = await getAdmin(pool, id);
  const errors = {};
  const passwordHash = await newPasswordHash(errors, password, confirm ?? '');
  if (!passwordHash) throw new ValidationError(errors);
  await pool.query('UPDATE admins SET password_hash = $1, session_epoch = session_epoch + 1 WHERE id = $2', [passwordHash, admin.id]);
}

// Returns the new session epoch so the caller can keep its own session signed in.
export async function changeOwnPassword(pool, id, { current_password: current, password, password_confirm: confirm }) {
  const { rows } = await pool.query('SELECT password_hash FROM admins WHERE id = $1 AND active', [id]);
  if (!rows[0]) throw new NotFoundError();
  const errors = {};
  if (!(await verifyPassword(String(current ?? ''), rows[0].password_hash))) errors.current_password = MESSAGES.current;
  const passwordHash = await newPasswordHash(errors, password, confirm ?? '');
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const updated = await pool.query(
    'UPDATE admins SET password_hash = $1, session_epoch = session_epoch + 1 WHERE id = $2 RETURNING session_epoch', [passwordHash, id]);
  return updated.rows[0].session_epoch;
}
