/** 联机消息名（客户端→服务器 C_，服务器→客户端 S_） */
export const MSG = {
  C_MOVE: 'move', // {seq,mx,mz,run}
  C_TIME: 'time', // {c}
  C_SEAT_REQUEST: 'seat.request', // {seatId,requestId}
  C_SEAT_LEAVE: 'seat.leave',
  C_SESSION_START: 'session.start', // {targetDisplayName,requestId}
  C_HIT: 'hit', // {sessionId,seq,ct}
  C_SESSION_END: 'session.end', // {sessionId}
  C_INPUT_FOCUS: 'input.focus', // {typing:boolean}
  C_FOREGROUND: 'fg', // {visible:boolean}
  S_TIME: 'time',
  S_SEAT_RESULT: 'seat.result',
  S_SESSION: 'session',
  S_HIT_ACK: 'hit.ack',
  S_RESULT: 'session.result',
  S_LEADERBOARD: 'leaderboard',
  S_WALLET: 'wallet',
  S_NOTICE: 'notice',
} as const;

/** 玩家可见状态（03） */
export const PSTATE = {
  MOVING: 0, SITTING: 1, SEATED_IDLE: 2, HITTING: 3, STANDING: 4, DISCONNECTED: 5, APPROACHING: 6,
} as const;
export type PState = (typeof PSTATE)[keyof typeof PSTATE];

/** 座位状态（03）：FREE → RESERVED → SITTING → OCCUPIED → STANDING → FREE */
export const SEAT_STATE = { FREE: 0, RESERVED: 1, SITTING: 2, OCCUPIED: 3, STANDING: 4 } as const;

export interface LeaderRow { rank: number; targetId: number; displayName: string; count: number }
export interface TargetTotal { targetId: number; displayName: string; today: number; all: number }
/** today/all：前 N 名；changed：本次推送窗口内有变化的目标（含榜外目标）的最新今日/累计数 */
export interface LeaderboardPayload { today: LeaderRow[]; all: LeaderRow[]; changed: TargetTotal[]; day: string; updatedAt: number; seq: number }

export interface SessionResult {
  sessionId: string;
  targetDisplayName: string;
  acceptedCount: number;
  maxCombo: number;
  targetToday: number;
  targetAllTime: number;
  todayRank: number | null;
  allRank: number | null;
  contribution: number;
  status: 'sealed' | 'pending';
  day: string;
}

export interface WalletView { coins: number; energy: number; maxEnergy: number; nextEnergyInMs: number | null }

/** 表情（同房广播，服务器只接受清单内的） */
export const EMOTES = ['😊', '👋', '🙏', '😂', '❤️', '👍', '😤', '🎉', '😋', '🍵', '🤤', '😭', '🥰', '😎', '🧧', '💸', '🙇', '💃', '🙌'] as const;
/** 聊天：同房实时，每条最多 40 字，每人约 1.2 秒一条 */
export const CHAT = { maxChars: 40, minGapMs: 1200 } as const;
/** 清理聊天文字：去掉控制字符和尖括号，压缩空白；空的返回 null */
export function cleanChat(t: unknown): string | null {
  if (typeof t !== 'string') return null;
  const s = Array.from(t.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim()).slice(0, CHAT.maxChars).join('');
  return s ? s : null;
}
