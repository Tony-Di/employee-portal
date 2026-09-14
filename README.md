# 员工门户 / Employee Portal

员工从同一个首页找到并打开公司常用网站；管理员在后台维护网站、分类和门户内容，日常更新不需要改代码或重新部署。

A single homepage where employees find company applications, with an admin console for maintaining the directory. Server-rendered Node.js (Express 5 + EJS) on PostgreSQL — no frontend build step.

- English by default (changeable in Settings), 中文 per visitor, with fallback to whichever language was filled in
- Light / dark mode toggle (defaults to the system setting), remembered per browser
- Sites: draft, published, hidden, placeholder; drag-and-drop or ↑/↓ ordering; preset icons or uploaded images
- Categories, portal title/description/logo, default language
- SEG Solar branding (logo, Kanit typeface, red/navy palette, following segsolar.com); an uploaded logo replaces the default
- Admin email/password accounts managed from the command line

Design and scope: [docs/portal-implementation-plan.md](docs/portal-implementation-plan.md).

## Local development

Requires Node.js 24 and Docker (for the development database).

```bash
npm ci
npm run setup                                  # creates .env with a random SESSION_SECRET
docker compose -f compose.dev.yml up -d        # PostgreSQL 16 on 127.0.0.1:55432
npm run migrate
npm run admin -- create --email you@company.com --name "Your Name"   # prompts for the password
npm run dev                                    # http://localhost:3100, admin at /admin
```

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm start` | Run with / without file watching |
| `npm test` | Full test suite against `TEST_DATABASE_URL` (database name must end in `_test`; created and wiped automatically) |
| `npm run check` | Syntax-check all JavaScript and compile all templates |
| `npm run migrate` | Apply pending SQL migrations (the server also does this on start) |
| `npm run admin -- list` | List admins |
| `npm run admin -- reset-password --email …` | Set a new password (hidden prompt) |
| `npm run admin -- deactivate --email …` / `activate` | Revoke or restore access; deactivation ends existing sessions immediately |

## Admin accounts

There is no sign-up page: the portal is read-only for employees, and only people given an account can change it. Whoever runs the server creates admin accounts from the command line, which is why the first admin cannot register in the browser. Until one exists, `/admin/login` shows the command to run.

```bash
npm run admin -- create --email you@segsolar.com --name "Your Name"   # locally
docker compose exec portal npm run admin -- create --email … --name … # in production
```

## Project layout

```text
src/server.js          entry point: config, migrations, HTTP server, graceful shutdown
src/app.js             Express app (security headers, sessions, language/theme, routes, errors)
src/routes/            public.js (homepage, /api/portal, /media, /healthz), admin-pages.js, admin-api.js
src/services/          sites, categories, settings, media, admins, portal catalog, ordering
src/middleware/        admin guard, language/theme preferences, uploads
views/                 EJS pages and partials
public/                CSS, browser JavaScript, favicon, SEG logos (brand/), Kanit fonts (fonts/, SIL OFL 1.1)
migrations/            numbered SQL migrations
scripts/               setup, migrate, admin, check
tests/                 node:test suites (real PostgreSQL, real HTTP)
```

## Configuration (.env)

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string for the portal's own database |
| `SESSION_SECRET` | Random, at least 32 characters (`npm run setup` generates one) |
| `APP_ORIGIN` | Public URL. Must be `https://` in production |
| `NODE_ENV` | `production` enables secure cookies and HSTS |
| `TRUST_PROXY` | `1` when running behind one reverse proxy (needed for correct client IPs and HTTPS detection) |
| `HOST` / `PORT` | Listen address, default `127.0.0.1:3100` |
| `DATA_DIR` | Uploaded images live in `DATA_DIR/uploads` — back this up together with the database |
| `COOKIE_SECURE` | Development only; production always uses secure cookies |

Production cookies are `Secure`, so the admin console only works over HTTPS (through the reverse proxy), not via `http://server-ip:port`.

## Deployment (Docker)

`compose.yml` runs one portal container that joins the existing database and reverse-proxy networks; it does not start a database.

1. Create a dedicated database and user on the chosen PostgreSQL server, limited to that database:
   ```sql
   CREATE USER portal WITH PASSWORD '…';
   CREATE DATABASE employee_portal OWNER portal;
   ```
2. On the server, create `.env` (`npm run setup` locally or copy `.env.example`) with `NODE_ENV=production`, `APP_ORIGIN=https://…`, `TRUST_PROXY=1`, `DATABASE_URL=postgresql://portal:…@<db-container-name>:5432/employee_portal`, plus `DB_NETWORK` and `PROXY_NETWORK` set to the existing Docker network names (`docker network ls`).
3. Start and create the first admin:
   ```bash
   docker compose up -d --build
   docker compose exec portal npm run admin -- create --email admin@company.com --name "Admin"
   ```
4. Point the reverse proxy at `portal:3100`. `GET /healthz` returns `{"ok":true}` when the app and database are reachable.

Update: `git pull && docker compose up -d --build` (migrations run on start; uploads persist in the `portal_uploads` volume).

## Backup and restore

Back up the database and the uploads together.

```bash
# Backup
docker exec <db-container> pg_dump -U portal -d employee_portal --format=custom --no-owner > portal-$(date +%F).dump
docker run --rm -v employee-portal_portal_uploads:/data -v "$PWD":/backup alpine tar -czf /backup/uploads-$(date +%F).tgz -C /data uploads

# Restore into an empty database and volume
docker exec -i <db-container> pg_restore -U portal -d employee_portal --no-owner < portal-YYYY-MM-DD.dump
docker run --rm -v employee-portal_portal_uploads:/data -v "$PWD":/backup alpine tar -xzf /backup/uploads-YYYY-MM-DD.tgz -C /data
```

This procedure was checked by restoring a dump into a fresh database and starting the portal against it.
