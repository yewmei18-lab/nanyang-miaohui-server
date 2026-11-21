import pg from 'pg';
import { ENV } from './env.ts';

// date 列按字符串返回，避免时区换算错位
pg.types.setTypeParser(1082, (v: string) => v);
// bigint 计数转 number（样板量级安全）
pg.types.setTypeParser(20, (v: string) => Number(v));

export const pgOptions: pg.ClientConfig = {
  connectionString: ENV.DATABASE_URL,
  ssl: ENV.DB_SSL ? { rejectUnauthorized: false } : undefined,
  // 独立 schema：所有未加前缀的表名都落在这个隔间里
  options: ENV.DB_SCHEMA ? `-c search_path=${ENV.DB_SCHEMA}` : undefined,
};
export const pool = new pg.Pool({ ...pgOptions, max: 8 });

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    c.release();
  }
}
