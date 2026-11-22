import { dayIndex, rng } from '@nanyang/shared';

/**
 * 灯谜题库（只放在服务器：客户端答完才看到答案和解释）。
 * 题目原文不改；每题 4 个选项 = 答案 + 3 个同类的错答案。
 */
export interface Riddle { q: string; hint: string; answer: string; wrong: [string, string, string]; why: string }

const Z = '打一字';
export const RIDDLES: Riddle[] = [
  // ── 字谜（打一字） ──
  { q: '一口咬掉牛尾巴', hint: Z, answer: '告', wrong: ['吉', '舌', '名'], why: '「牛」去掉下面出头的尾巴，底下加一个「口」，就是「告」。' },
  { q: '千里相逢', hint: Z, answer: '重', wrong: ['量', '野', '埋'], why: '「千」和「里」上下叠在一起，就是「重」。' },
  { q: '半个月亮', hint: Z, answer: '胖', wrong: ['伴', '朋', '判'], why: '「半」加上「月」（月亮），就是「胖」。' },
  { q: '十个哥哥', hint: Z, answer: '克', wrong: ['兄', '竞', '古'], why: '「十」放在「兄」（哥哥）上面，就是「克」。' },
  { q: '一人一张口，口下长只手', hint: Z, answer: '拿', wrong: ['合', '拾', '拳'], why: '「人」「一」「口」合成「合」，下面再加「手」，就是「拿」。' },
  { q: '两个月亮一起走', hint: Z, answer: '朋', wrong: ['明', '胖', '用'], why: '两个「月」并排，就是「朋」。' },
  { q: '日月同辉', hint: Z, answer: '明', wrong: ['朋', '旦', '晶'], why: '「日」和「月」放在一起，就是「明」。' },
  { q: '人在云中', hint: Z, answer: '会', wrong: ['运', '众', '云'], why: '把「人」放进「云」字上面，就是「会」。' },
  { q: '大口吃小口', hint: Z, answer: '回', wrong: ['日', '品', '吕'], why: '大的「口」里面包着小的「口」，就是「回」。' },
  { q: '一斗米', hint: Z, answer: '料', wrong: ['粮', '科', '斜'], why: '「米」加「斗」，就是「料」。' },
  { q: '门里有人', hint: Z, answer: '闪', wrong: ['问', '闭', '们'], why: '「门」里面放一个「人」，就是「闪」。' },
  { q: '王先生白先生坐在石头上', hint: Z, answer: '碧', wrong: ['皇', '珀', '硕'], why: '「王」「白」在上，「石」在下，就是「碧」。' },
  { q: '早不说晚不说', hint: Z, answer: '许', wrong: ['话', '诈', '讲'], why: '不早不晚是中午（午），「讠」（说）加「午」，就是「许」。' },
  { q: '九十九', hint: Z, answer: '白', wrong: ['百', '自', '旧'], why: '一百少一是九十九：「百」去掉上面的「一」，就是「白」。' },
  { q: '自小在一起，目前少联系', hint: Z, answer: '省', wrong: ['看', '相', '盼'], why: '「少」在上，「目」在下，合起来就是「省」。' },
  { q: '一边是红，一边是绿，一边喜风，一边喜雨', hint: Z, answer: '秋', wrong: ['炒', '种', '烛'], why: '红的是「火」，喜风；绿的是「禾」，喜雨；合起来是「秋」。' },
  { q: '上不在上，下不在下，人有它大，天没它大', hint: Z, answer: '一', wrong: ['二', '十', '口'], why: '「上」「下」都有「一」；「人」加「一」是「大」，「天」去掉「一」也是「大」。' },
  { q: '有水能养鱼虾，有土能种庄稼，有人不是你我，有马跑遍天下', hint: Z, answer: '也', wrong: ['包', '巴', '皮'], why: '「也」加水是「池」，加土是「地」，加人是「他」，加马是「驰」。' },
  { q: '二人土上坐', hint: Z, answer: '坐', wrong: ['丛', '座', '垒'], why: '两个「人」在「土」上面，就是「坐」。' },
  // ── 物谜 ──
  { q: '麻屋子，红帐子，里面住着白胖子', hint: '打一食物', answer: '花生', wrong: ['核桃', '栗子', '莲子'], why: '麻麻的壳是屋子，红色薄皮是帐子，白白的花生仁是白胖子。' },
  { q: '小小诸葛亮，独坐中军帐，摆下八卦阵，专捉飞来将', hint: '打一动物', answer: '蜘蛛', wrong: ['螳螂', '蜜蜂', '蚂蚁'], why: '蜘蛛坐在网中间，网像八卦阵，专抓飞进来的虫。' },
  { q: '身穿绿衣裳，肚里水汪汪，生的子儿多，个个黑脸膛', hint: '打一水果', answer: '西瓜', wrong: ['木瓜', '杨桃', '红毛丹'], why: '西瓜皮是绿的，里面很多水，瓜子是黑色的。' },
  { q: '红口袋，绿口袋，有人怕，有人爱', hint: '打一蔬菜', answer: '辣椒', wrong: ['茄子', '黄瓜', '番茄'], why: '辣椒有红有绿，怕辣的人怕，爱辣的人爱。' },
  { q: '有面没有口，有脚没有手，虽有四只脚，自己不会走', hint: '打一家具', answer: '桌子', wrong: ['衣柜', '书架', '屏风'], why: '桌子有桌面、四只桌脚，可是自己不会走。' },
  { q: '千条线，万条线，掉到水里看不见', hint: '打一自然现象', answer: '雨', wrong: ['风', '雾', '彩虹'], why: '雨丝像一条条线，落进水里就看不见了。' },
  { q: '外面刺刺，里面香香，有人爱得要命，有人闻到就跑', hint: '打一水果', answer: '榴莲', wrong: ['山竹', '红毛丹', '芒果'], why: '榴莲壳上全是刺，果肉很香，爱的人很爱，怕的人闻到就跑。' },
  { q: '身穿黄袍子，弯弯像月亮', hint: '打一水果', answer: '香蕉', wrong: ['芒果', '柠檬', '杨桃'], why: '香蕉皮是黄的，形状弯弯像月亮。' },
  { q: '头戴红帽子，身穿白袍子，走路摆架子，说话伸脖子', hint: '打一动物', answer: '鹅', wrong: ['鸭子', '鸽子', '孔雀'], why: '鹅头上有红色的肉冠，一身白毛，走路摇摇摆摆，叫的时候伸长脖子。' },
  { q: '白房子，没门窗，里面住着黄姑娘', hint: '打一食物', answer: '鸡蛋', wrong: ['馒头', '豆腐', '年糕'], why: '蛋壳是白房子，没有门窗，里面的蛋黄就是黄姑娘。' },
  { q: '有头没有颈，身上冷冰冰，有翅不会飞，无脚也能行', hint: '打一动物', answer: '鱼', wrong: ['蛇', '青蛙', '乌龟'], why: '鱼没有脖子，身上冷冰冰；鳍像翅膀但不会飞，没有脚也能游。' },
];
export const RIDDLES_PER_DAY = 3;
export const RIDDLE_PAY = 3;

/** 今天（马来西亚日期）的 3 题：每个人一样 */
export function riddlesOfDay(day: string): number[] {
  const r = rng((dayIndex(day) * 2654435761) >>> 0); const pool = RIDDLES.map((_, i) => i); const out: number[] = [];
  for (let i = 0; i < RIDDLES_PER_DAY; i++) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}
/** 这一题今天的 4 个选项（顺序固定：同一天每个人一样） */
export function riddleChoices(day: string, idx: number): string[] {
  const R = RIDDLES[idx]; const a = [R.answer, ...R.wrong]; const r = rng(((dayIndex(day) * 31 + idx) * 40503) >>> 0);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
