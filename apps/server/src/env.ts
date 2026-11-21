import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// 读取本地 .env（不提交；见 .env.example）
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

export const ENV = {
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  PORT: Number(process.env.PORT ?? 2567),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? '*',
  /** 与其他项目共用数据库时，把本游戏所有表放进独立 schema（“隔间”），不碰原项目数据 */
  DB_SCHEMA: (process.env.DB_SCHEMA ?? '').replace(/[^a-z0-9_]/g, ''),
  DB_SSL: process.env.DB_SSL === 'true',
};
if (!ENV.DATABASE_URL) {
  console.error('缺少 DATABASE_URL，请复制 apps/server/.env.example 为 .env');
  process.exit(1);
}
