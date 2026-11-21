import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ENV } from './env.ts';
import { migrate } from './migrate.ts';
import { mountHttp } from './http.ts';
import { PlazaRoom } from './rooms/PlazaRoom.ts';
import { hitPipeline, leaderboard, recoverInterruptedSessions } from './hits.ts';
import { GAME_CONFIG } from '@nanyang/shared';

process.on('uncaughtException', (e) => { console.error('[server] uncaughtException', e); });
// 兜底：记录而不让单个房间的异常拖垮整个游戏服务
process.on('unhandledRejection', (e) => { console.error('[server] unhandledRejection', e); });
process.on('exit', (code) => { console.error('[server] exit code', code); });

async function main() {
  await migrate();
  const recovered = await recoverInterruptedSessions();
  if (recovered) console.log(`[recover] ${recovered} 个未结算的局已按已落盘事件封存为 interrupted`);
  hitPipeline.start();
  await leaderboard.start();

  const server = new Server({
    transport: new WebSocketTransport({ pingInterval: 3000, pingMaxRetries: 3 }),
    express: (app) => mountHttp(app),
    greet: false,
  });
  server.define(GAME_CONFIG.room.name, PlazaRoom);
  await server.listen(ENV.PORT);
  console.log(`[server] 南洋庙会 游戏服务 ws://localhost:${ENV.PORT}`);

  const shutdown = async (sig: string) => {
    console.log(`[server] 收到 ${sig}，保存待写事件后退出`);
    await hitPipeline.flush().catch(() => {});
    hitPipeline.stop();
    await leaderboard.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
main().catch((e) => { console.error(e); process.exit(1); });
