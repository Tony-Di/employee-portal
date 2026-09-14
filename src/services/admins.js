import { hashPassword, verifyPassword } from '../auth.js';

const PUBLIC_FIELDS = 'id, name, email';
// Verified against when the email is unknown so both paths spend the same scrypt time.
const DUMMY_HASH = `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;

export const normalizeEmail = email => String(email ?? '').trim().toLowerCase();

export async function createAdmin(pool, { name, email, password }) {
  name = String(name ?? '').trim();
  email = normalizeEmail(email);
  if (!name || name.length > 100) throw new Error('Name must contain 1–100 characters.');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  const passwordHash = await hashPassword(password);
  try {
    const { rows } = await pool.query(
      `INSERT INTO admins(name, email, password_hash) VALUES ($1, $2, $3) RETURNING ${PUBLIC_FIELDS}`,
      [name, email, passwordHash]);
    return rows[0];
  } catch (error) {
    if (error.code === '23505') throw new Error(`An admin with email ${email} already exists.`);
    throw error;
  }
}

export async function authenticate(pool, email, password) {
  const { rows } = await pool.query(
    `SELECT ${PUBLIC_FIELDS}, password_hash, active FROM admins WHERE email = $1`, [normalizeEmail(email)]);
  const admin = rows[0];
  const valid = await verifyPassword(password, admin?.password_hash ?? DUMMY_HASH);
  if (!admin || !valid || !admin.active) return null;
  return { id: admin.id, name: admin.name, email: admin.email };
}

export async function findActiveAdmin(pool, id) {
  if (!Number.isInteger(id)) return null;
  const { rows } = await pool.query(`SELECT ${PUBLIC_FIELDS} FROM admins WHERE id = $1 AND active`, [id]);
  return rows[0] ?? null;
}

export async function resetPassword(pool, email, password) {
  const passwordHash = await hashPassword(password);
  const { rowCount } = await pool.query('UPDATE admins SET password_hash = $1 WHERE email = $2', [passwordHash, normalizeEmail(email)]);
  return rowCount === 1;
}

export async function setAdminActive(pool, email, active) {
  const { rowCount } = await pool.query('UPDATE admins SET active = $1 WHERE email = $2', [active, normalizeEmail(email)]);
  return rowCount === 1;
}

export async function hasAdmins(pool) {
  return (await pool.query('SELECT EXISTS (SELECT 1 FROM admins) AS any')).rows[0].any;
}

export async function listAdmins(pool) {
  return (await pool.query(`SELECT ${PUBLIC_FIELDS}, active, created_at FROM admins ORDER BY id`)).rows;
}
