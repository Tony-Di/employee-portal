import express from 'express';
import { publicCatalog } from '../services/portal.js';
import { uploadDir } from '../services/media.js';

export function publicRoutes({ config, pool }) {
  const router = express.Router();

  // Uploaded files have random, never-reused names, so they can be cached for a long time.
  router.use('/media', express.static(uploadDir(config.dataDir), { index: false, dotfiles: 'deny', maxAge: '30d', immutable: true }));

  router.get('/', async (req, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    const category = String(req.query.category ?? '');
    const catalog = await publicCatalog(pool);
    const filtered = q || category ? await publicCatalog(pool, { q, category }) : catalog;
    const matches = new Set(filtered.sites.map(s => s.id));
    res.set('Cache-Control', 'no-store');
    res.render('home', { ...catalog, matches, q, category, bodyClass: 'home' });
  });

  // Browsers request /favicon.ico regardless of the <link rel="icon">.
  router.get('/favicon.ico', (req, res) => res.redirect(301, '/static/favicon.svg'));

  router.get('/healthz', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  router.get('/api/portal', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await publicCatalog(pool));
  });

  return router;
}
