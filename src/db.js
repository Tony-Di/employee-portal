import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from './config.js';

export function createPool(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000 });
  pool.on('error', error => console.error('Database connection error:', error.code || error.name));
  return pool;
}

export async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function migrate(pool) {
  await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(76433001)');
    await client.query('CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = new Set((await client.query('SELECT name FROM migrations')).rows.map(row => row.name));
    const files = (await readdir(path.join(root, 'migrations'))).filter(name => /^\d+.*\.sql$/.test(name)).sort();
    for (const name of files) {
      if (applied.has(name)) continue;
      await client.query(await readFile(path.join(root, 'migrations', name), 'utf8'));
      await client.query('INSERT INTO migrations(name) VALUES ($1)', [name]);
    }
  });
}
