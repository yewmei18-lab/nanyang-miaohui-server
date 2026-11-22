import { schema, t, type SchemaType } from '@colyseus/schema';

export const PlayerS = schema({
  name: t.string().default(''),
  av: t.string().default(''), // 角色配置索引，逗号分隔（服务器从数据库读取并校验）
  x: t.float32().default(0),
  z: t.float32().default(0),
  yaw: t.float32().default(0),
  speed: t.float32().default(0),
  st: t.uint8().default(0), // PSTATE
  seat: t.int8().default(-1),
  actAt: t.float64().default(0), // 动作服务器开始时间
  hitSeq: t.uint32().default(0), // 本局已接受击打次数（驱动他人看到的拍击动作）
  lastInput: t.uint32().default(0), // 已处理的最后输入 seq（客户端重放校正）
  conn: t.boolean().default(true),
  orng: t.uint8().default(0), // 手上的旺桔（舞狮接到的）
  lamp: t.boolean().default(false), // 百灯过桥：手上提着灯
  hold: t.string().default(''), // 手上拿着的东西：tea / ice:玫瑰红色,班兰绿色
  mask: t.string().default(''), // 戴着的面具
  tie: t.string().default(''), // 第 5 批：正在和谁牵红绳（对方的 sid）
  show: t.string().default(''), // 坐在 Mamak 时摆在桌上的作品（work id）
  nogift: t.boolean().default(false), // 不收礼物
  noinv: t.boolean().default(false), // 不接受邀请（合照/斗擦胶/红绳）
}, 'Player');
export type PlayerS = SchemaType<typeof PlayerS>;

export const SeatS = schema({
  id: t.uint8().default(0),
  st: t.uint8().default(0), // SEAT_STATE
  by: t.string().default(''), // 占用者 sessionId
  until: t.float64().default(0),
  food: t.string().default(''), // MAMAK：桌上这个位置前面放着的食物（菜单 id）
  hold: t.string().default(''), // 打小人排队：这个空位留给谁（sessionId）
}, 'Seat');
export type SeatS = SchemaType<typeof SeatS>;

/** MAMAK 店员 Aneh（店员，不是玩家；不计入人数） */
export const StaffS = schema({
  x: t.float32().default(0),
  z: t.float32().default(0),
  yaw: t.float32().default(0),
  speed: t.float32().default(0),
  carry: t.string().default(''), // 手上端着的食物
  act: t.uint8().default(0), // 0 走/站 1 在桌边问点什么 2 放下食物 3 在柜台准备
  seat: t.int8().default(-1), // 正在服务的座位
}, 'Staff');
export type StaffS = SchemaType<typeof StaffS>;

/** 舞狮抛出的桔子 */
export const OrangeS = schema({
  id: t.string().default(''),
  x: t.float32().default(0),
  z: t.float32().default(0),
  t0: t.float64().default(0), // 抛出的服务器时间（客户端从狮头飞过来）
  by: t.string().default(''), // 被谁接到
}, 'Orange');
export type OrangeS = SchemaType<typeof OrangeS>;

export const PlazaState = schema({
  no: t.uint16().default(0), // 房间编号（庙会 01、02…）
  players: t.map(PlayerS),
  seats: t.array(SeatS),
  aneh: StaffS,
  incense: t.uint8().default(0), // 香炉里正在烧的香（束）
  vq: t.uint8().default(0), // 打小人排队人数
  evOff: t.float64().default(0), // 活动时钟偏移（只在本地测试时用）
  ev: t.string().default(''), // 正在进行的活动（开估 / 布袋戏 / 百灯过桥）的公开进度（JSON）
  lamps: t.uint16().default(0), // 石桥上点亮了哪几盏灯（位）
  hat: t.string().default(''), // 后台选的帽子（下一场布袋戏的 Uncle 戴）
  oranges: t.array(OrangeS),
}, 'PlazaState');
export type PlazaState = SchemaType<typeof PlazaState>;
