import { findActiveAdmin } from '../services/admins.js';

export function requireAdmin(pool) {
  return async (req, res, next) => {
    const found = await findActiveAdmin(pool, req.session.adminId);
    // A password change bumps session_epoch, which ends sessions started before it.
    if (found && found.session_epoch === (req.session.adminEpoch ?? 0)) {
      const admin = { id: found.id, name: found.name, email: found.email };
      req.admin = admin;
      res.locals.admin = admin;
      return next();
    }
    if (req.session.adminId) { delete req.session.adminId; delete req.session.adminEpoch; }
    if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'unauthenticated' });
    res.redirect(302, '/admin/login');
  };
}
