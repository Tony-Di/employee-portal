import { createPool, migrate } from '../src/db.js';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required. Configure .env first.'); process.exit(1); }
const pool = createPool(process.env.DATABASE_URL);
try {
  await migrate(pool);
  const { rows } = await pool.query('SELECT name FROM migrations ORDER BY name');
  console.log(`Migrations applied: ${rows.map(r => r.name).join(', ')}`);
} catch (error) {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
