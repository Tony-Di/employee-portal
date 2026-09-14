import { mkdir } from 'node:fs/promises';
import { getConfig } from './config.js';
import { createPool, migrate } from './db.js';
import { createApp } from './app.js';
import { uploadDir } from './services/media.js';

let config;
try {
  config = getConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const pool = createPool(config.databaseUrl);
await migrate(pool);
await mkdir(uploadDir(config.dataDir), { recursive: true });

const app = createApp({ config, pool });
const pruneTimer = setInterval(() => app.locals.sessionStore.pruneSessions(), 15 * 60 * 1000);
pruneTimer.unref();

const server = app.listen(config.port, config.host, () => {
  console.log(`Employee portal listening on http://${config.host}:${config.port} (${config.origin})`);
});

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down.`);
  clearInterval(pruneTimer);
  const force = setTimeout(() => server.closeAllConnections(), 10_000);
  force.unref();
  server.closeIdleConnections();
  await new Promise(resolve => server.close(resolve));
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
