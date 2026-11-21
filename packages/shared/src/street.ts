/** 第 4 批街上的小东西：冰球糖浆、面具、晾纸架好话、祝福预设、游园纸印章 */
export const SYRUPS = [
  { id: 'rose', name: '玫瑰红', color: '#e8577a' }, { id: 'pandan', name: '班兰绿', color: '#5cbf5a' },
  { id: 'butterfly', name: '蝶豆蓝', color: '#4a7fe0' }, { id: 'mango', name: '芒果黄', color: '#f2c14e' },
] as const;
export const MASKS = [
  { id: 'opera', name: '红脸戏曲' }, { id: 'cat', name: '白猫' }, { id: 'lion', name: '小狮头' }, { id: 'peacock', name: '孔雀蜡染' },
] as const;
/** 晾纸架：一句有本地味的好话（每人每天一张，按日期轮） */
export const GOOD_WORDS = [
  '今天一路青灯', '做事顺顺，吃饭香香', '出门遇贵人，回家有热汤', '心宽一点，天就大一点', '慢慢来，比较快',
  '今天的烦恼，明天就淡了', '有朋友一起，路就不远', '运气像拉茶，越拉越香', '小小心愿，慢慢会实现', '笑一笑，衰气走光光',
  '吃饱饱，睡好好，钱包胖胖', '你比你想的更厉害', '好事正在排队找你', '今天适合对自己好一点', '平安就是最大的福',
  '收工一路青灯', '和家人吃顿饭吧', '不急，花会开的', '今天做一件让自己开心的事', '旺到你家门口',
];
/** 祝福留言架的预设句子（不想打字的人直接选） */
export const BLESS_PRESETS = ['今天顺顺', '收工一路青灯', '身体健康', '大家平安', '心想事成', '旺旺旺！'];
/** 游园纸：逛过这些地方会盖章 */
export const STAMPS = [
  { id: 'villain', name: '打小人' }, { id: 'pray', name: '上香' }, { id: 'mamak', name: 'Mamak' }, { id: 'woodfish', name: '木鱼' },
  { id: 'bath', name: '洗衰运' }, { id: 'wish', name: '姻缘树' }, { id: 'night', name: '夜市街' }, { id: 'kids', name: '童玩' },
  { id: 'bridge', name: '石桥' }, { id: 'stage', name: '戏台' }, { id: 'cat', name: '找到橘猫' }, { id: 'photo', name: '拍照' },
] as const;
export type StampId = (typeof STAMPS)[number]['id'];
/** 某天（马来西亚日期 YYYY-MM-DD）对应的整数，用来轮换（橘猫、好话） */
export const dayIndex = (day: string) => Math.floor(Date.parse(day + 'T00:00:00Z') / 86_400_000);
