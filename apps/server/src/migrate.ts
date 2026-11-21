import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.ts';
import { ENV } from './env.ts';

export async function migrate(log = true) {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
  // 隔间已经存在就不再建（云端的游戏账号没有建库级权限，只拥有自己的隔间）
  if (ENV.DB_SCHEMA) {
    const ex = await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [ENV.DB_SCHEMA]);
    if (!ex.rowCount) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${ENV.DB_SCHEMA}`);
  }
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = readFileSync(resolve(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      if (log) console.log('migrated', f);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally { c.release(); }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
