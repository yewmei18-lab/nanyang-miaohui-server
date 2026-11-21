/**
 * 统一玩法配置（首轮试玩参数，来源：交接包 v2 06/07）。
 * 客户端与服务器共用同一份；修改数值必须提升 CONFIG_VERSION。
 * 已开局/已下单的记录保存当时的 configVersion，不追溯。
 */
export const CONFIG_VERSION = 'v2-trial-4';

export const GAME_CONFIG = {
  version: CONFIG_VERSION,
  timezone: 'Asia/Kuala_Lumpur',
  room: {
    name: 'plaza',
    maxClients: 20,
    simulationHz: 30,
    patchMs: 66, // 约 15Hz 快照
    reconnectGraceSec: 15,
  },
  movement: {
    walkSpeed: 2.2, // m/s
    runSpeed: 4.0,
    playerRadius: 0.28,
    inputDt: 1 / 30, // 每条输入代表固定一步，不信任客户端 dt
    maxInputCredit: 12, // 服务器每 tick +1；防加速
  },
  seat: {
    reserveMs: 3000,
    sitDownMs: 700,
    standUpMs: 600,
    interactRadius: 2.2,
  },
  villain: {
    countdownMs: 3000,
    durationMs: 10000, // 用户 2026-11-21：一局 10 秒
    energyCost: 5,
    /** 结束边界网络宽限（07：最多 200ms） */
    endGraceMs: 200,
    /** 连击：两次已接受击打间隔 ≤ 800ms */
    comboGapMs: 800,
    /**
     * 反作弊高频阈值：滑动 1 秒内超过此数视为脚本，超出部分拒绝并记录。
     * 不是玩法上限（旧 8/s 已取消）。人类极限连点约 12–16 次/秒，此值待真机实测调整。
     */
    antiCheatMaxPerSecond: 25,
    maxSeqPerSession: 2000,
    nameMaxChars: 20,
  },
  woodfish: {
    /** 反作弊：1 秒内超过此数视为脚本（人手极限约 12–16 次/秒） */
    antiCheatMaxPerSecond: 20,
  },
  bath: {
    /** 洗衰运：每满 60 秒恢复 5 精力 + 10 金币，金币每天最多 100 个（用户 2026-11-21 改：原交接包是 1 金币/分钟、每天 10 个） */
    rewardEveryMs: 60_000, energy: 5, coins: 10, dailyCoinCap: 100,
    /** 前台心跳超过此时间没收到就暂停计时并清掉未满一分钟的进度 */
    heartbeatTimeoutMs: 8_000,
  },
  wish: { introMaxChars: 120, igMaxChars: 30 },
  /** MAMAK（06 第 2、5 节）：价格/恢复精力；Milo Ais 是交接包以外新增的 */
  mamak: {
    menu: [
      { id: 'tehtarik', name: 'Teh Tarik', price: 5, energy: 10, verb: '喝' },
      { id: 'milo', name: 'Milo Ais', price: 6, energy: 15, verb: '喝' },
      { id: 'roti', name: 'Roti Canai', price: 8, energy: 20, verb: '吃' },
      { id: 'nasilemak', name: 'Nasi Lemak', price: 12, energy: 35, verb: '吃' },
    ],
    eatMs: 5000,
    cookMs: 1000,
    /** Aneh 在桌边等你点单的最长时间 */
    askTimeoutMs: 25_000,
    staffSpeed: 2.6,
  },
  /** 求签（06 第 7 节）：免费；每天只能求一次（用户 2026-11-21 定），这一次有 10% 机会天降 50 金币 */
  fortune: { firstDailyLuckChance: 0.1, luckCoins: 50, shakeMs: 2600, cooldownMs: 4000 },
  /** 天后宫：上香免费；香油钱（金币） */
  pray: { donateAmounts: [1, 6, 8, 18], incenseMs: 180_000, maxIncense: 9, incenseCooldownMs: 8_000 },
  leaderboard: {
    flushIntervalMs: 250,
    topN: 10,
    refreshThrottleMs: 60,
  },
  wallet: {
    initialCoins: 200,
    initialEnergy: 100,
    maxEnergy: 100,
    energyRegenMs: 180_000,
  },
  nickname: { minChars: 1, maxChars: 12 },
} as const;

export type GameConfig = typeof GAME_CONFIG;
