import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { csrfToken, regenerate, saveSession, verifyCsrf } from '../auth.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { ICON_LABELS } from '../icons.js';
import { authenticate, hasAdmins } from '../services/admins.js';
import { createCategory, deleteCategory, getCategory, listCategories, moveCategory, updateCategory } from '../services/categories.js';
import { saveMedia } from '../services/media.js';
import { getSettings } from '../services/portal.js';
import { updateSettings } from '../services/settings.js';
import { createSite, getSite, listSites, moveSite, setSiteStatus, STATUSES, updateSite } from '../services/sites.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { optionalUpload } from '../middleware/upload.js';

const flash = (req, type, message) => { req.session.flash = { type, message }; };
const isFormError = error => error instanceof ValidationError || error instanceof ConflictError;

export function adminPages({ config, pool }) {
  const router = express.Router();

  const renderLogin = async (req, res, status, { email = '', error = null } = {}) =>
    res.status(status).render('admin/login', { csrf: csrfToken(req), email, error, noAdmins: !(await hasAdmins(pool)) });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: config.loginAttempts ?? 10, skipSuccessfulRequests: true,
    standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (req, res, next) => renderLogin(req, res, 429, {
      email: String(req.body?.email ?? ''),
      error: res.locals.t('登录失败次数过多，请 15 分钟后再试。', 'Too many failed attempts. Try again in 15 minutes.'),
    }).catch(next),
  });

  router.get('/', (req, res) => res.redirect(302, '/admin/sites'));

  router.get('/login', (req, res) => {
    if (req.session.adminId) return res.redirect(302, '/admin/sites');
    return renderLogin(req, res, 200);
  });

  router.post('/login', loginLimiter, verifyCsrf, async (req, res) => {
    const email = String(req.body.email ?? '').slice(0, 254);
    const admin = await authenticate(pool, email, String(req.body.password ?? ''));
    if (!admin) {
      return renderLogin(req, res, 401, { email, error: res.locals.t('邮箱或密码不正确。', 'Incorrect email or password.') });
    }
    await regenerate(req);
    req.session.adminId = admin.id;
    await saveSession(req);
    res.redirect(303, '/admin/sites');
  });

  router.post('/logout', verifyCsrf, async (req, res) => {
    await new Promise((resolve, reject) => req.session.destroy(error => (error ? reject(error) : resolve())));
    res.clearCookie('portal.sid', { httpOnly: true, sameSite: 'lax', secure: config.secureCookies });
    res.redirect(303, '/admin/login');
  });

  router.use(requireAdmin(pool));
  router.use((req, res, next) => {
    res.locals.csrf = csrfToken(req);
    res.locals.path = req.baseUrl + req.path;
    res.locals.notice = req.session.flash ?? null;
    delete req.session.flash;
    res.set('Cache-Control', 'no-store');
    next();
  });

  // ---- Sites ----
  router.get('/sites', async (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 100);
    const status = STATUSES.includes(req.query.status) ? req.query.status : '';
    res.render('admin/sites', { sites: await listSites(pool, { q, status }), q, status, filtered: Boolean(q || status) });
  });

  const renderSiteForm = async (req, res, status, { site = null, values, errors = {}, conflict = null }) => {
    res.status(status).render('admin/site-form', {
      site, values, errors, conflict, categories: await listCategories(pool), iconLabels: ICON_LABELS,
    });
  };

  // Saves an uploaded icon first so the site can reference it; a failed site save keeps the upload's id in the form.
  async function withIcon(req) {
    const body = { ...req.body };
    if (req.uploadError) throw req.uploadError;
    if (body.remove_icon) body.media_id = '';
    if (req.file?.size) body.media_id = (await saveMedia(pool, config.dataDir, req.file.buffer, req.admin.id)).id;
    return body;
  }

  router.get('/sites/new', (req, res) => renderSiteForm(req, res, 200, {
    values: { icon_key: 'globe', open_in_new_tab: true, status: 'draft' },
  }));

  router.post('/sites', optionalUpload('icon_file'), verifyCsrf, async (req, res) => {
    let body = req.body;
    try {
      body = await withIcon(req);
      const site = await createSite(pool, body, req.admin.id);
      flash(req, 'success', site.status === 'published'
        ? ['已发布，员工刷新首页即可看到。', 'Published. Employees see it the next time they load the portal.']
        : ['已保存。', 'Saved.']);
      res.redirect(303, `/admin/sites/${site.id}/edit`);
    } catch (error) {
      if (!isFormError(error)) throw error;
      await renderSiteForm(req, res, error.status, { values: body, errors: error.errors ?? {}, conflict: error.messagePair });
    }
  });

  router.get('/sites/:id/edit', async (req, res) => {
    const site = await getSite(pool, req.params.id);
    await renderSiteForm(req, res, 200, { site, values: site });
  });

  router.post('/sites/:id', optionalUpload('icon_file'), verifyCsrf, async (req, res) => {
    const site = await getSite(pool, req.params.id);
    let body = req.body;
    try {
      body = await withIcon(req);
      const saved = await updateSite(pool, site.id, body, req.admin.id);
      flash(req, 'success', saved.status === 'published'
        ? ['已保存，首页已更新。', 'Saved. The portal now shows the changes.']
        : ['已保存。', 'Saved.']);
      res.redirect(303, `/admin/sites/${site.id}/edit`);
    } catch (error) {
      if (!isFormError(error)) throw error;
      await renderSiteForm(req, res, error.status, { site, values: { ...site, ...body }, errors: error.errors ?? {}, conflict: error.messagePair });
    }
  });

  const backToList = req => {
    const target = String(req.body.return_to ?? '');
    return /^\/admin\/sites(\?[^\s]*)?$/.test(target) ? target : '/admin/sites';
  };

  router.post('/sites/:id/status', verifyCsrf, async (req, res) => {
    try {
      const site = await setSiteStatus(pool, req.params.id, String(req.body.status ?? ''), req.admin.id);
      const messages = {
        published: ['已上架，员工刷新首页即可看到。', 'Published to the portal.'],
        hidden: ['已隐藏，员工首页不再显示。', 'Hidden from the portal.'],
        draft: ['已改为草稿。', 'Moved back to draft.'],
        placeholder: ['已设为占位。', 'Shown as a placeholder.'],
      };
      flash(req, 'success', messages[site.status]);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      flash(req, 'error', error.errors.url ?? Object.values(error.errors)[0]);
    }
    res.redirect(303, backToList(req));
  });

  router.post('/sites/:id/move', verifyCsrf, async (req, res) => {
    await moveSite(pool, req.params.id, req.body.direction === 'up' ? 'up' : 'down');
    res.redirect(303, backToList(req));
  });

  // ---- Categories ----
  const renderCategories = async (req, res, status, { values = {}, errors = {}, editing = null } = {}) =>
    res.status(status).render('admin/categories', { categories: await listCategories(pool), values, errors, editing });

  router.get('/categories', (req, res) => renderCategories(req, res, 200));

  router.post('/categories', verifyCsrf, async (req, res) => {
    try {
      await createCategory(pool, req.body);
      flash(req, 'success', ['分类已添加。', 'Category added.']);
      res.redirect(303, '/admin/categories');
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      await renderCategories(req, res, 422, { values: req.body, errors: error.errors });
    }
  });

  router.post('/categories/:id', verifyCsrf, async (req, res) => {
    const category = await getCategory(pool, req.params.id);
    try {
      await updateCategory(pool, category.id, req.body);
      flash(req, 'success', ['分类已保存。', 'Category saved.']);
      res.redirect(303, '/admin/categories');
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      await renderCategories(req, res, 422, { editing: { id: category.id, ...req.body }, errors: error.errors });
    }
  });

  router.post('/categories/:id/delete', verifyCsrf, async (req, res) => {
    try {
      await deleteCategory(pool, req.params.id);
      flash(req, 'success', ['分类已删除。', 'Category deleted.']);
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      flash(req, 'error', error.messagePair);
    }
    res.redirect(303, '/admin/categories');
  });

  router.post('/categories/:id/move', verifyCsrf, async (req, res) => {
    await moveCategory(pool, req.params.id, req.body.direction === 'up' ? 'up' : 'down');
    res.redirect(303, '/admin/categories');
  });

  // ---- Portal settings ----
  const renderSettings = async (req, res, status, { values, errors = {}, conflict = null }) => {
    const settings = await getSettings(pool);
    res.status(status).render('admin/settings', { settings, values: values ?? settings, errors, conflict });
  };

  router.get('/settings', (req, res) => renderSettings(req, res, 200, {}));

  router.post('/settings', optionalUpload('logo_file'), verifyCsrf, async (req, res) => {
    const body = { ...req.body };
    try {
      if (req.uploadError) throw req.uploadError;
      if (body.remove_logo) body.logo_id = '';
      else if (req.file?.size) body.logo_id = (await saveMedia(pool, config.dataDir, req.file.buffer, req.admin.id)).id;
      else delete body.logo_id;
      await updateSettings(pool, body, req.admin.id);
      flash(req, 'success', ['门户设置已保存，首页已更新。', 'Settings saved. The portal now shows the changes.']);
      res.redirect(303, '/admin/settings');
    } catch (error) {
      if (!isFormError(error)) throw error;
      await renderSettings(req, res, error.status, { values: body, errors: error.errors ?? {}, conflict: error.messagePair });
    }
  });

  router.use((error, req, res, next) => {
    if (!(error instanceof NotFoundError)) return next(error);
    res.status(404).render('error', { status: 404, message: res.locals.t('内容不存在或已被删除。', 'This item does not exist or was deleted.') });
  });

  return router;
}
