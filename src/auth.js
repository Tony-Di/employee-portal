import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    throw new Error('Password must contain 6–128 characters.');
  }
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [algorithm, salt, hex] = (stored || '').split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hex || '')) return false;
  const key = await deriveKey(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}

export function csrfToken(req) {
  req.session.csrfToken ||= randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

export function verifyCsrf(req, res, next) {
  const supplied = req.get('x-csrf-token') || req.body?._csrf;
  const expected = req.session.csrfToken;
  if (typeof supplied !== 'string' || !expected || supplied.length !== expected.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    const message = res.locals.t('表单已过期，请刷新页面后重试。', 'This form expired. Refresh the page and try again.');
    if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ error: 'csrf', message });
    return res.status(403).render('error', { status: 403, message });
  }
  next();
}

export const regenerate = req => new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
export const saveSession = req => new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
