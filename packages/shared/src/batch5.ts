/**
 * 第 5 批：三条街坊故事、每周摊主、每日三个小发现、送礼/邀请、地图找路。
 * 服务器和客户端共用同一份数据（地点、台词、价格），服务器负责判断“你真的走到了没有”。
 */
import { CAT_SPOTS, SPOTS, WISH_TREE } from './world3d.ts';
import { dayIndex } from './street.ts';

const spot = (id: string) => { const s = SPOTS.find((x) => x.id === id)!; return { x: s.x, z: s.z }; };

// ───────── 街坊故事 ─────────
export type StoryId = 'slip' | 'cat' | 'photo';
export interface StoryStep {
  /** 走到哪里（cat = 今天橘猫在的地方） */
  at: { x: number; z: number } | 'cat';
  r: number;
  /** 头上的提示 */
  label: string;
  /** 谁在说话 */
  who: string;
  lines: string[];
}
export interface Story { id: StoryId; title: string; teaser: string; reward: number; keepsake: string; steps: StoryStep[] }

/** Mamak 门口那张红凳（橘猫有时也睡在这里） */
const MAMAK_STOOL = { x: 0.4, z: 15.3 }; // 红凳旁的街边（不压在桌位上，免得和「坐下吃东西」抢）
export const STORIES: Story[] = [
  {
    id: 'slip', title: '阿伯，你的单掉了', teaser: 'Mamak 门口有一张被风吹走的单', reward: 20, keepsake: '阿伯的旧单',
    steps: [
      { at: MAMAK_STOOL, r: 1.3, label: '捡起地上的单', who: 'Aneh', lines: ['诶，这张单是刚才那位阿伯的！', '上面写着：「两杯拉茶，一杯少甜。1975 年起」。', '他好像往夜市街那边走了，你帮忙追一下？'] },
      { at: spot('tea'), r: 2.0, label: '问拉茶档', who: '拉茶档主', lines: ['阿伯？他每天来，拉茶一定要两杯。', '一杯他喝，一杯放在旁边……说是等老伴。', '刚才他说要买个面具给孙子，往前面走了。'] },
      { at: spot('mask'), r: 2.0, label: '问面具档', who: '面具档 Auntie', lines: ['有有有，他买了一个小狮头面具。', '他说孙子明天第一次来庙会。', '然后他说要去河边喂鱼，每天都去。'] },
      { at: spot('fish'), r: 2.0, label: '把单交给阿伯', who: '阿伯', lines: ['哎呀！我的单！', '这是我老伴以前写的，她写字比我好看。', '五十年了，每天两杯拉茶。谢谢你啊，年轻人。'] },
    ],
  },
  {
    id: 'cat', title: '橘猫偷了谁的位？', teaser: '戏班师傅说：我的位子被猫占了', reward: 20, keepsake: '橘猫的红绳',
    steps: [
      { at: spot('backstage'), r: 2.0, label: '问戏班师傅', who: '戏班师傅', lines: ['我每次看戏坐的那张小凳，被一只橘猫占了！', '它还把我帽子上的红绳叼走了。', '今天它不知道又躲去哪里，你帮我找找？'] },
      { at: 'cat', r: 2.0, label: '找到橘猫', who: '橘猫', lines: ['喵～', '（嘴里叼着一条红绳，看了你一眼，往姻缘树那边跑了）'] },
      { at: { x: WISH_TREE.standX, z: WISH_TREE.standZ }, r: 2.4, label: '看看姻缘树下', who: '你', lines: ['姻缘树下堆着好多红绳，都是大家掉的。', '原来橘猫每天把掉在地上的红绳，叼回姻缘树。', '师傅那条也在这里。'] },
      { at: spot('backstage'), r: 2.0, label: '把红绳还给师傅', who: '戏班师傅', lines: ['哈哈，原来它是在帮月老做工！', '那张小凳就让给它吧。', '它比我还会看戏。'] },
    ],
  },
  {
    id: 'photo', title: '找不到人的半张照片', teaser: '老照片墙后面夹着半张照片', reward: 25, keepsake: '当年与现在',
    steps: [
      { at: spot('photowall'), r: 2.0, label: '看看照片墙后面', who: '你', lines: ['墙后面夹着半张发黄的照片。', '一个少年坐在红色的塑料凳上拉茶，另一半被撕掉了。', '背面写着：「1978 年庙会。我们说好，老了再来这里拍一张。」'] },
      { at: spot('wishrack'), r: 2.0, label: '翻翻祝福架', who: '一张祝福牌', lines: ['「寻人：1978 年庙会，坐红凳拉茶的少年。」', '「我手上有另外半张。我每年都来，红凳还在吗？」', '——没有留名字。'] },
      { at: spot('tea'), r: 2.0, label: '问拉茶档', who: '拉茶档主', lines: ['红凳？那是我阿公的档！', '以前拉茶档就摆在 Mamak 门口，那张红凳到现在还在。', '照片上拉茶的少年……就是我阿公。'] },
      { at: MAMAK_STOOL, r: 1.3, label: '在红凳前拍一张', who: '你', lines: ['你站在当年那张红凳前。', '一半是 1978 年，一半是现在。', '这张「当年与现在」，挂上祝福架，那个人一定看得到。'] },
    ],
  },
];
/** 第几步的地点（猫那一步按日期） */
export function storyTarget(st: StoryStep, day: string): { x: number; z: number } {
  if (st.at === 'cat') { const c = CAT_SPOTS[dayIndex(day) % CAT_SPOTS.length]; return { x: c.x, z: c.z }; }
  return st.at;
}

// ───────── 每周摊主（马来西亚时间每周一 00:00 换） ─────────
export const WEEKLY_SPOT = { x: -15.2, z: 8.0, r: 1.5 };
export const WEEKLY = [
  { id: 'dough', name: '捏面人阿伯', sign: '捏面人', price: 12, intro: '一团米面，捏一只给你带回家。', works: [
    { id: 'dough_lion', name: '面人小狮头' }, { id: 'dough_cat', name: '面人橘猫' }, { id: 'dough_rabbit', name: '面人小兔' }, { id: 'dough_fu', name: '面人阿福' },
  ] },
  { id: 'lantern', name: '花灯婆婆', sign: '花灯', price: 12, intro: '纸扎花灯，晚上会亮。', works: [
    { id: 'lamp_rabbit', name: '兔子灯' }, { id: 'lamp_carp', name: '鲤鱼灯' }, { id: 'lamp_star', name: '杨桃灯' }, { id: 'lamp_lotus', name: '莲花灯' },
  ] },
] as const;
export type WorkId = (typeof WEEKLY)[number]['works'][number]['id'];
export const ALL_WORKS: ReadonlyArray<{ id: string; name: string }> = WEEKLY.flatMap((w) => w.works as ReadonlyArray<{ id: string; name: string }>);
/** 马来西亚时间的“第几周”（每周一 00:00 换） */
export function weekIndex(ms: number): number { return Math.floor((Math.floor((ms + 8 * 3600_000) / 86_400_000) + 3) / 7); }
export function weeklyVendor(ms: number) { return WEEKLY[weekIndex(ms) % WEEKLY.length]; }
/** 下一次换摊主的时间（毫秒） */
export function nextWeekly(ms: number): number { return ((weekIndex(ms) + 1) * 7 - 3) * 86_400_000 - 8 * 3600_000; }

// ───────── 每日三个小发现（游园纸上圈出来的三个章） ─────────
const DISCOVER_POOL = ['night', 'kids', 'bridge', 'stage', 'cat', 'photo', 'wish', 'bath', 'woodfish', 'pray', 'villain', 'mamak'] as const;
export const DISCOVER_REWARD = 10;
export function dailyDiscoveries(day: string): string[] {
  const n = dayIndex(day); const pool: string[] = [...DISCOVER_POOL]; const out: string[] = [];
  let s = (n * 2654435761) >>> 0;
  for (let i = 0; i < 3; i++) { s = (s * 1103515245 + 12345) >>> 0; out.push(pool.splice(s % pool.length, 1)[0]); }
  return out;
}

// ───────── 送礼 / 邀请 ─────────
/** 可以送人的东西：面人、花灯、Mamak 请客券 */
export const isGiftable = (item: string) => item === 'voucher' || ALL_WORKS.some((w) => `work:${w.id}` === item);
export const giftName = (item: string) => item === 'voucher' ? 'Mamak 请客券' : ALL_WORKS.find((w) => `work:${w.id}` === item)?.name ?? item;
export const GIFT_TIMEOUT_MS = 30_000;
export const INVITE_TIMEOUT_MS = 15_000;
export type InviteKind = 'eraser' | 'photo' | 'redstring';
export const INVITE_NAMES: Record<InviteKind, string> = { eraser: '一起斗擦胶', photo: '拍张合照', redstring: '牵红绳' };
export const REDSTRING_MS = 90_000;

// ───────── 地图：分区 + 找路 ─────────
export const MAP_GROUPS: Array<{ name: string; places: Array<{ name: string; x: number; z: number }> }> = [
  { name: '庙口', places: [{ name: '天后宫', x: 0.5, z: 26 }, { name: '上香', x: 0.5, z: 22.4 }, { name: '求签', x: 8.0, z: 24.4 }, { name: '姻缘树', x: 2.9, z: 14.5 }] },
  { name: '老街', places: [{ name: 'Mamak', x: -0.4, z: 17 }, { name: '打小人', x: -2.6, z: 10.7 }, { name: '烧烦恼', x: -3.8, z: 3 }, { name: '游艺档', x: -3.8, z: 0.2 }, { name: '抽红包', x: -3.9, z: 5.6 }, { name: '命理阁', x: 4.2, z: 2 }, { name: '游园纸', x: 2.6, z: -1.3 }] },
  { name: '夜市街', places: [{ name: '拉茶', x: -15.2, z: 17 }, { name: '冰球', x: -15.2, z: 11 }, { name: '每周摊', x: WEEKLY_SPOT.x, z: WEEKLY_SPOT.z }, { name: '面具', x: -15.2, z: 5 }, { name: '红纸', x: -14.6, z: 14 }, { name: '五粒子', x: -14.7, z: 20 }, { name: '捞金鱼', x: -14.5, z: 1.0 }] },
  { name: '童玩巷', places: [{ name: '斗擦胶', x: -9, z: -3 }, { name: '弹珠台', x: -11.9, z: -3.2 }, { name: '跳飞机', x: -15.3, z: -6 }] },
  { name: '灯笼巷', places: [{ name: '老照片', x: 4.9, z: -5.4 }, { name: '祝福架', x: 10.4, z: -5.6 }, { name: '对对碰', x: 11.6, z: -3.4 }, { name: '猜灯谜', x: 8.0, z: -4.0 }] },
  { name: '水边', places: [{ name: '撒鱼粮', x: 17.6, z: -4.2 }, { name: '打鼓', x: 15.5, z: 2.3 }] },
  { name: '后院', places: [{ name: '木鱼禅院', x: 26.5, z: 29 }, { name: '洗衰运', x: -13, z: 28 }, { name: '听雨水缸', x: 25.4, z: 25.4 }] },
  { name: '东边空地', places: [{ name: '布袋戏台', x: 12.5, z: 15 }, { name: '月老庙', x: 13.3, z: 20.4 }, { name: '戏台后台', x: 16.45, z: 15 }] },
  { name: '牌坊外', places: [{ name: '天灯', x: -4.4, z: -8.6 }, { name: '拍照', x: 0, z: -9.5 }, { name: '套圈', x: 2.1, z: -8.4 }] },
];
/** 走得通的路口（试玩时真的走过的路线），用来画地图上的红线 */
const NODES: Array<[number, number]> = [
  [0, -1], [1.2, 2], [3, 12], [0.5, 18], [0.5, 24.6], [-1.5, -1], [-5, -1.9], [-9, -3], [-11.9, -3.2], [-13.8, -4.2], [-15, -2], [-15.2, 5], [-15.2, 11], [-15.2, 17], [-14.7, 20],
  [-14.7, 22.6], [-13, 23.4], [-9, 24.8], [3.4, 24.8], [9.6, 25], [8.45, 24.6], [8.45, 20.3], [9.8, 20.2], [2, -1.6], [6.4, -2.2], [11.6, -3.4], [16.2, -4.2], [17.6, -4.2], [15.5, 0.5],
  [1, -2.8], [4.9, -5.6], [0, -6], [-15.3, -6], [25.4, 25.4], [23.4, 29.0], [-12.4, 27], [26.5, 29.0],
  [14.5, 8], [12.5, 15], [12.6, 22], [16.45, 15], [17.4, 29.0],
];
const EDGES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 16], [16, 17], [17, 18], [18, 4], [18, 19],
  [19, 20], [20, 21], [21, 22], [0, 23], [23, 24], [24, 25], [25, 26], [26, 27], [27, 28], [0, 29], [29, 30], [29, 31], [9, 32], [19, 41], [39, 41], [41, 34], [34, 33], [16, 35], [34, 36], [1, 23],
  [28, 37], [37, 38], [38, 39], [39, 19], [38, 40],
];
/** 从 a 走到 b 的折线（地图上画红线 + 地上的箭头用） */
export function routeBetween(a: { x: number; z: number }, b: { x: number; z: number }): Array<{ x: number; z: number }> {
  const near = (p: { x: number; z: number }) => NODES.reduce((bi, n, i) => (Math.hypot(n[0] - p.x, n[1] - p.z) < Math.hypot(NODES[bi][0] - p.x, NODES[bi][1] - p.z) ? i : bi), 0);
  const s = near(a), t = near(b);
  const dist = NODES.map(() => Infinity); const prev = NODES.map(() => -1); dist[s] = 0; const done = new Set<number>();
  while (done.size < NODES.length) {
    let u = -1; for (let i = 0; i < NODES.length; i++) if (!done.has(i) && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break; done.add(u); if (u === t) break;
    for (const [x, y] of EDGES) { const v = x === u ? y : y === u ? x : -1; if (v < 0) continue; const d = dist[u] + Math.hypot(NODES[u][0] - NODES[v][0], NODES[u][1] - NODES[v][1]); if (d < dist[v]) { dist[v] = d; prev[v] = u; } }
  }
  const path: Array<{ x: number; z: number }> = []; for (let v = t; v >= 0; v = prev[v]) { path.unshift({ x: NODES[v][0], z: NODES[v][1] }); if (v === s) break; }
  return [a, ...path, b];
}
