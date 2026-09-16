import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import path from 'node:path';
import { root } from './config.js';
import { locale } from './middleware/locale.js';
import { adminPages } from './routes/admin-pages.js';
import { adminApi } from './routes/admin-api.js';
import { publicRoutes } from './routes/public.js';
import { ICONS } from './icons.js';

export function createApp({ config, pool, logger = console }) {
  const app = express();
  app.locals.icons = ICONS;
  app.set('view engine', 'ejs');
  app.set('views', path.join(root, 'views'));
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'blob:'], 'upgrade-insecure-requests': config.production ? [] : null } },
    strictTransportSecurity: config.production,
  }));
  app.use('/static', express.static(path.join(root, 'public'), { maxAge: config.production ? '1h' : 0 }));

  // Before body parsing, so even requests rejected by the parsers get a translated error page.
  app.use(locale(pool, config));

  const PgStore = connectPgSimple(session);
  const store = new PgStore({ pool, tableName: 'sessions', createTableIfMissing: false, pruneSessionInterval: false });
  app.locals.sessionStore = store;
  app.use(session({
    name: 'portal.sid', store, secret: config.sessionSecret, resave: false, saveUninitialized: false, rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: 8 * 3600 * 1000 },
  }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.json({ limit: '100kb' }));

  app.use(publicRoutes({ config, pool }));
  app.use('/admin', adminPages({ config, pool }));
  app.use('/api/admin', adminApi({ config, pool }));

  app.use((req, res) => {
    if (req.originalUrl.startsWith('/api/')) return res.status(404).json({ error: 'not_found' });
    res.status(404).render('error', { status: 404, message: res.locals.t('页面不存在。', 'Page not found.') });
  });
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = error.status || error.statusCode || 500;
    if (status >= 500) logger.error(error);
    const t = res.locals.t || ((zh, en) => en);
    const message = status === 413 ? t('提交内容过大。', 'The submitted content is too large.')
      : status < 500 ? t('请求无效。', 'The request is invalid.')
      : t('服务暂时不可用，请稍后再试。', 'The service is temporarily unavailable. Please try again later.');
    if (req.originalUrl.startsWith('/api/')) return res.status(status).json({ error: status < 500 ? 'bad_request' : 'server_error', message });
    const shown = status >= 500 ? 503 : status;
    res.status(shown).render('error', { status: shown, message });
  });
  return app;
}
