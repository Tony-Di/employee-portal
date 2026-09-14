const LANGS = new Set(['zh', 'en']);
const THEMES = new Set(['light', 'dark']);
const YEAR = 365 * 24 * 3600 * 1000;

function readCookie(req, name) {
  const match = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1];
}

// Resolves language (?lang=, cookie, portal default) and theme (?theme=, cookie, else follow the system).
export function locale(pool, { secureCookies }) {
  return async (req, res, next) => {
    let lang = LANGS.has(req.query.lang) ? req.query.lang : null;
    if (lang) res.cookie('portal_lang', lang, { maxAge: YEAR, sameSite: 'lax', secure: secureCookies, httpOnly: true });
    lang ||= LANGS.has(readCookie(req, 'portal_lang')) ? readCookie(req, 'portal_lang') : null;
    if (!lang) {
      try {
        lang = (await pool.query('SELECT default_language FROM portal_settings WHERE id = 1')).rows[0]?.default_language;
      } catch { /* fall back below; the route reports database failures */ }
    }
    lang = LANGS.has(lang) ? lang : 'en';

    let theme = THEMES.has(req.query.theme) ? req.query.theme : null;
    // Not HttpOnly: the toggle script updates this cookie so switching needs no reload.
    if (theme) res.cookie('portal_theme', theme, { maxAge: YEAR, sameSite: 'lax', secure: secureCookies, httpOnly: false });
    theme ||= THEMES.has(readCookie(req, 'portal_theme')) ? readCookie(req, 'portal_theme') : null;

    req.lang = lang;
    res.locals.lang = lang;
    res.locals.theme = theme;
    res.locals.t = (zh, en) => (lang === 'en' ? en : zh);
    res.locals.tp = pair => (Array.isArray(pair) ? (lang === 'en' ? pair[1] : pair[0]) : pair);
    // Bilingual field with fallback to whichever language was filled in.
    res.locals.pick = (row, field) => (lang === 'en' ? row[`${field}_en`] || row[field] : row[field] || row[`${field}_en`]) || '';
    // Link to the current page with one preference changed, keeping filters such as ?q= and ?category=.
    res.locals.switchUrl = (key, value) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(req.query)) if (!['lang', 'theme'].includes(k) && typeof v === 'string') params.set(k, v);
      params.set(key, value);
      return `${req.baseUrl}${req.path}?${params}`;
    };
    next();
  };
}
