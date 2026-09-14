import express from 'express';
import { csrfToken, verifyCsrf } from '../auth.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { optionalUpload } from '../middleware/upload.js';
import { createCategory, deleteCategory, listCategories, reorderCategories, updateCategory } from '../services/categories.js';
import { saveMedia } from '../services/media.js';
import { getSettings } from '../services/portal.js';
import { updateSettings } from '../services/settings.js';
import { createSite, getSite, listSites, reorderSites, updateSite } from '../services/sites.js';

const mediaUrl = filename => (filename ? `/media/${filename}` : null);
const siteJson = ({ media_filename, ...site }) => ({ ...site, icon_url: mediaUrl(media_filename) });
const settingsJson = ({ logo_filename, ...settings }) => ({ ...settings, logo_url: mediaUrl(logo_filename) });

export function adminApi({ config, pool }) {
  const router = express.Router();
  router.use(requireAdmin(pool));
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    return ['GET', 'HEAD'].includes(req.method) || req.path === '/media' ? next() : verifyCsrf(req, res, next);
  });

  router.get('/me', (req, res) => res.json({ admin: req.admin, csrfToken: csrfToken(req) }));

  router.get('/sites', async (req, res) => res.json({ sites: (await listSites(pool, req.query)).map(siteJson) }));
  router.post('/sites', async (req, res) => res.status(201).json({ site: siteJson(await createSite(pool, req.body, req.admin.id)) }));
  router.put('/sites/order', async (req, res) => { await reorderSites(pool, req.body?.ids); res.json({ ok: true }); });
  router.get('/sites/:id', async (req, res) => res.json({ site: siteJson(await getSite(pool, req.params.id)) }));
  router.patch('/sites/:id', async (req, res) => res.json({ site: siteJson(await updateSite(pool, req.params.id, req.body, req.admin.id)) }));

  router.get('/categories', async (req, res) => res.json({ categories: await listCategories(pool) }));
  router.post('/categories', async (req, res) => res.status(201).json({ category: await createCategory(pool, req.body) }));
  router.put('/categories/order', async (req, res) => { await reorderCategories(pool, req.body?.ids); res.json({ ok: true }); });
  router.patch('/categories/:id', async (req, res) => res.json({ category: await updateCategory(pool, req.params.id, req.body) }));
  router.delete('/categories/:id', async (req, res) => { await deleteCategory(pool, req.params.id); res.status(204).end(); });

  router.get('/settings', async (req, res) => res.json({ settings: settingsJson(await getSettings(pool)) }));
  router.patch('/settings', async (req, res) => res.json({ settings: settingsJson(await updateSettings(pool, req.body, req.admin.id)) }));

  router.post('/media', optionalUpload('file'), verifyCsrf, async (req, res) => {
    if (req.uploadError) throw req.uploadError;
    res.status(201).json({ media: await saveMedia(pool, config.dataDir, req.file?.buffer, req.admin.id) });
  });

  router.use((error, req, res, next) => {
    const { tp } = res.locals;
    if (error instanceof ValidationError) {
      return res.status(422).json({ error: 'validation', errors: Object.fromEntries(Object.entries(error.errors).map(([k, v]) => [k, tp(v)])) });
    }
    if (error instanceof ConflictError) return res.status(409).json({ error: 'conflict', message: tp(error.messagePair) });
    if (error instanceof NotFoundError) return res.status(404).json({ error: 'not_found' });
    next(error);
  });

  return router;
}
