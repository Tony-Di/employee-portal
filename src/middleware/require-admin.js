import { findActiveAdmin } from '../services/admins.js';

export function requireAdmin(pool) {
  return async (req, res, next) => {
    const admin = await findActiveAdmin(pool, req.session.adminId);
    if (admin) {
      req.admin = admin;
      res.locals.admin = admin;
      return next();
    }
    if (req.session.adminId) delete req.session.adminId;
    if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'unauthenticated' });
    res.redirect(302, '/admin/login');
  };
}
