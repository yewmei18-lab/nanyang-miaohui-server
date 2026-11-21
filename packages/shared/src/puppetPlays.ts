/**
 * 庙口布袋戏：三出原创小戏，每出两个结局（观众投票决定演哪个）。
 * t = 这一段开始后第几秒；who = afu（阿福）/ cat（橘猫）/ uncle（Mamak 档主）；pos = 站在戏台哪里（0 左 … 1 右）
 */
export type PuppetId = 'afu' | 'cat' | 'uncle';
export interface PuppetLine { t: number; who: PuppetId; text: string; pos?: number; jump?: boolean }
export interface PuppetPlay {
  title: string;
  cast: PuppetId[];
  part1: PuppetLine[];
  question: string;
  options: [string, string];
  endings: [PuppetLine[], PuppetLine[]];
}

export const PUPPET_PLAYS: PuppetPlay[] = [
  {
    title: '谁偷吃了旺桔？',
    cast: ['afu', 'cat', 'uncle'],
    part1: [
      { t: 0, who: 'afu', text: '今天庙会！我带了一篮旺桔要拜妈祖～', pos: 0.25 },
      { t: 9, who: 'afu', text: '咦？我的桔子怎么少了一颗？', pos: 0.3, jump: true },
      { t: 18, who: 'uncle', text: 'Aiyo 阿福，什么事这么紧张？', pos: 0.75 },
      { t: 27, who: 'afu', text: 'Uncle，你有看到我的桔子吗？', pos: 0.35 },
      { t: 36, who: 'uncle', text: '我刚才在拉茶，眼睛只看着杯子咯！', pos: 0.7 },
      { t: 46, who: 'cat', text: '喵～（舔舔嘴巴）', pos: 0.55 },
      { t: 55, who: 'afu', text: '那只橘猫刚才往 Mamak 那边跑了……', pos: 0.3 },
      { t: 65, who: 'uncle', text: '地上好像也有一点点桔子皮哦。', pos: 0.75 },
      { t: 76, who: 'afu', text: '大家帮我想想，我应该先去哪里找？', pos: 0.4, jump: true },
    ],
    question: '阿福应该先去哪里找？',
    options: ['问 Mamak 档主', '跟着橘猫'],
    endings: [
      [
        { t: 0, who: 'afu', text: 'Uncle，你的柜台下面是什么？', pos: 0.6 },
        { t: 9, who: 'uncle', text: '哈哈！原来掉进我的茶桶旁边了！', pos: 0.75, jump: true },
        { t: 19, who: 'uncle', text: '来来来，这杯 limau ais 请你，算我的。', pos: 0.7 },
        { t: 30, who: 'afu', text: '谢谢 Uncle！桔子找到，还多一杯冰！', pos: 0.45 },
        { t: 42, who: 'cat', text: '喵（明明是我先发现的……）', pos: 0.2 },
        { t: 54, who: 'afu', text: '好啦好啦，也分你一点旺气～', pos: 0.35, jump: true },
      ],
      [
        { t: 0, who: 'cat', text: '喵～喵～（快跟我来）', pos: 0.7 },
        { t: 9, who: 'afu', text: '你要带我去哪里？', pos: 0.5 },
        { t: 18, who: 'cat', text: '（把桔子推到阿福脚边）', pos: 0.45, jump: true },
        { t: 28, who: 'afu', text: '原来你是帮我把滚走的桔子追回来！', pos: 0.4 },
        { t: 40, who: 'uncle', text: '这只猫比我还会做生意，懂得留住客人！', pos: 0.8 },
        { t: 52, who: 'afu', text: '谢谢小橘，今天一起去拜拜！', pos: 0.4, jump: true },
      ],
    ],
  },
  {
    title: '拉茶比赛',
    cast: ['afu', 'uncle', 'cat'],
    part1: [
      { t: 0, who: 'uncle', text: '各位街坊！今晚 Mamak 举办拉茶比赛！', pos: 0.7, jump: true },
      { t: 10, who: 'afu', text: '我要报名！我在家练了一个礼拜！', pos: 0.3 },
      { t: 20, who: 'uncle', text: '好！规矩很简单：拉得高、泡要多、一滴不洒。', pos: 0.7 },
      { t: 31, who: 'afu', text: '（拉高……再拉高……）', pos: 0.35, jump: true },
      { t: 41, who: 'cat', text: '喵！（被茶香吸引过来）', pos: 0.55 },
      { t: 50, who: 'uncle', text: '小心！猫来了，手不要抖！', pos: 0.75 },
      { t: 60, who: 'afu', text: '它在我脚边转来转去，我快拿不稳了！', pos: 0.3 },
      { t: 72, who: 'uncle', text: '阿福，你要继续拉，还是先停下来？', pos: 0.7 },
    ],
    question: '阿福要怎么办？',
    options: ['继续拉到最高', '先停下来抱猫'],
    endings: [
      [
        { t: 0, who: 'afu', text: '我拉！拉！拉——', pos: 0.4, jump: true },
        { t: 9, who: 'uncle', text: '哇！这个高度，可以去申请纪录了！', pos: 0.75 },
        { t: 19, who: 'cat', text: '（一跳，刚好接住一点泡泡）喵～', pos: 0.5, jump: true },
        { t: 30, who: 'uncle', text: '泡多、不洒，还娱乐到猫，冠军！', pos: 0.7 },
        { t: 42, who: 'afu', text: '冠军奖品是什么？', pos: 0.35 },
        { t: 52, who: 'uncle', text: '一个礼拜免费拉茶给全街喝，哈哈！', pos: 0.75, jump: true },
      ],
      [
        { t: 0, who: 'afu', text: '等等，先抱你起来，不要被烫到。', pos: 0.45 },
        { t: 10, who: 'cat', text: '（安静地趴在阿福肩膀上）', pos: 0.45 },
        { t: 20, who: 'uncle', text: '先顾小猫再比赛，这个才是真冠军。', pos: 0.7 },
        { t: 31, who: 'afu', text: '可是我的茶还没拉完……', pos: 0.4 },
        { t: 41, who: 'uncle', text: '我们一起拉一杯，两个人的手更稳！', pos: 0.65, jump: true },
        { t: 53, who: 'afu', text: '今晚的茶，是全庙会最甜的一杯！', pos: 0.4, jump: true },
      ],
    ],
  },
  {
    title: '灯笼不见了',
    cast: ['afu', 'cat', 'uncle'],
    part1: [
      { t: 0, who: 'afu', text: '今晚要提灯过桥，我的兔子灯呢？', pos: 0.3 },
      { t: 10, who: 'uncle', text: '刚才好像看到一只灯笼飘去姻缘树那边。', pos: 0.75 },
      { t: 21, who: 'cat', text: '喵（尾巴上挂着一条红绳）', pos: 0.55 },
      { t: 31, who: 'afu', text: '小橘，你身上怎么有红绳？', pos: 0.35, jump: true },
      { t: 41, who: 'cat', text: '喵～（往月老庙看了一眼）', pos: 0.6 },
      { t: 51, who: 'uncle', text: '会不会是月老想帮你牵线啊？哈哈！', pos: 0.75 },
      { t: 62, who: 'afu', text: '我要先去姻缘树，还是去石桥那边等？', pos: 0.4 },
    ],
    question: '阿福要去哪里找灯？',
    options: ['去姻缘树', '去石桥等'],
    endings: [
      [
        { t: 0, who: 'afu', text: '找到了！灯挂在姻缘树的枝上！', pos: 0.35, jump: true },
        { t: 10, who: 'cat', text: '（用红绳把灯拉下来）喵！', pos: 0.5 },
        { t: 21, who: 'uncle', text: '原来红绳是用来救灯的，这只猫有心思。', pos: 0.75 },
        { t: 32, who: 'afu', text: '谢谢小橘！我们一起提灯过桥吧！', pos: 0.4 },
        { t: 44, who: 'cat', text: '喵～（尾巴上的红绳一闪一闪）', pos: 0.55, jump: true },
      ],
      [
        { t: 0, who: 'afu', text: '我在桥上等，灯会自己回来吗？', pos: 0.45 },
        { t: 10, who: 'uncle', text: '看！河上漂来一盏兔子灯！', pos: 0.75, jump: true },
        { t: 21, who: 'cat', text: '（坐在灯上，慢慢漂过来）', pos: 0.55 },
        { t: 32, who: 'afu', text: '哈哈！原来你坐着我的灯去兜风！', pos: 0.4, jump: true },
        { t: 44, who: 'uncle', text: '今晚这座桥，最亮的就是你们俩。', pos: 0.7 },
      ],
    ],
  },
];
export const playForHour = (hour: number) => PUPPET_PLAYS[((hour % PUPPET_PLAYS.length) + PUPPET_PLAYS.length) % PUPPET_PLAYS.length];
