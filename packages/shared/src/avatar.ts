/** 固定预设捏脸（交接包 02）。只允许清单内枚举；服务器拒绝任意路径/参数。 */
export const AVATAR_SCHEMA_VERSION = 1;

export const AVATAR_OPTIONS = {
  base: ['m', 'f'] as const,
  nose: ['nose_01', 'nose_02', 'nose_03', 'nose_04'] as const,
  eye: ['eye_01', 'eye_02', 'eye_03', 'eye_04', 'eye_05', 'eye_06'] as const,
  mouth: ['mouth_01', 'mouth_02', 'mouth_03', 'mouth_04', 'mouth_05'] as const,
  skin: ['skin_01', 'skin_02', 'skin_03', 'skin_04', 'skin_05', 'skin_06'] as const,
  hair: ['hair_short_straight', 'hair_short_curly', 'hair_side_part', 'hair_bob_bangs', 'hair_long_straight', 'hair_long_curly', 'hair_ponytail', 'hair_bun'] as const,
  height: ['h_small', 'h_medium', 'h_tall'] as const,
};

export const AVATAR_LABELS: Record<string, string> = {
  m: '男生', f: '女生',
  nose_01: '小巧', nose_02: '圆润', nose_03: '挺直', nose_04: '宽一点',
  eye_01: '圆眼', eye_02: '笑眼', eye_03: '杏眼', eye_04: '下垂眼', eye_05: '细长眼', eye_06: '大眼',
  mouth_01: '微笑', mouth_02: '开心', mouth_03: '抿嘴', mouth_04: '小圆嘴', mouth_05: '咧嘴笑',
  skin_01: '白皙', skin_02: '自然', skin_03: '小麦', skin_04: '蜜色', skin_05: '棕色', skin_06: '深棕',
  hair_short_straight: '短直发', hair_short_curly: '短卷发', hair_side_part: '侧分短发', hair_bob_bangs: '齐刘海波波头',
  hair_long_straight: '长直发', hair_long_curly: '长卷发', hair_ponytail: '马尾', hair_bun: '丸子头',
  h_small: '小个子', h_medium: '中等', h_tall: '高个子',
};

/** 身高档（米），交接包建议 1.20/1.40/1.60 */
export const HEIGHT_METERS: Record<AvatarConfig['heightId'], number> = { h_small: 1.2, h_medium: 1.4, h_tall: 1.6 };

/** 肤色样本（统一灯光下校色，从浅到深） */
export const SKIN_COLORS: Record<AvatarConfig['skinId'], string> = {
  skin_01: '#F6DCCB', skin_02: '#EFC7AA', skin_03: '#DDAA82', skin_04: '#C68E66', skin_05: '#9C6644', skin_06: '#6E4630',
};

export interface AvatarConfig {
  schemaVersion: 1;
  baseId: (typeof AVATAR_OPTIONS.base)[number];
  noseId: (typeof AVATAR_OPTIONS.nose)[number];
  eyeId: (typeof AVATAR_OPTIONS.eye)[number];
  mouthId: (typeof AVATAR_OPTIONS.mouth)[number];
  skinId: (typeof AVATAR_OPTIONS.skin)[number];
  hairId: (typeof AVATAR_OPTIONS.hair)[number];
  heightId: (typeof AVATAR_OPTIONS.height)[number];
}

const FIELD_TO_OPTIONS: Record<Exclude<keyof AvatarConfig, 'schemaVersion'>, readonly string[]> = {
  baseId: AVATAR_OPTIONS.base,
  noseId: AVATAR_OPTIONS.nose,
  eyeId: AVATAR_OPTIONS.eye,
  mouthId: AVATAR_OPTIONS.mouth,
  skinId: AVATAR_OPTIONS.skin,
  hairId: AVATAR_OPTIONS.hair,
  heightId: AVATAR_OPTIONS.height,
};
export const AVATAR_FIELDS = Object.keys(FIELD_TO_OPTIONS) as Array<keyof typeof FIELD_TO_OPTIONS>;

export function validateAvatar(input: unknown): { ok: true; value: AvatarConfig } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'avatar_not_object' };
  const o = input as Record<string, unknown>;
  if (o.schemaVersion !== AVATAR_SCHEMA_VERSION) return { ok: false, error: 'avatar_bad_schema' };
  const allowedKeys = new Set(['schemaVersion', ...AVATAR_FIELDS]);
  for (const k of Object.keys(o)) if (!allowedKeys.has(k)) return { ok: false, error: `avatar_unknown_field:${k}` };
  const out: Record<string, unknown> = { schemaVersion: 1 };
  for (const f of AVATAR_FIELDS) {
    const v = o[f];
    if (typeof v !== 'string' || !FIELD_TO_OPTIONS[f].includes(v)) return { ok: false, error: `avatar_bad_value:${f}` };
    out[f] = v;
  }
  return { ok: true, value: out as unknown as AvatarConfig };
}

/** 随机只选有效预设 */
export function randomAvatar(rand: () => number = Math.random): AvatarConfig {
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length) % arr.length];
  return {
    schemaVersion: 1,
    baseId: pick(AVATAR_OPTIONS.base),
    noseId: pick(AVATAR_OPTIONS.nose),
    eyeId: pick(AVATAR_OPTIONS.eye),
    mouthId: pick(AVATAR_OPTIONS.mouth),
    skinId: pick(AVATAR_OPTIONS.skin),
    hairId: pick(AVATAR_OPTIONS.hair),
    heightId: pick(AVATAR_OPTIONS.height),
  };
}

export const DEFAULT_AVATAR: AvatarConfig = {
  schemaVersion: 1, baseId: 'f', noseId: 'nose_02', eyeId: 'eye_01', mouthId: 'mouth_01', skinId: 'skin_02', hairId: 'hair_bob_bangs', heightId: 'h_medium',
};

/** 网络紧凑编码：每项一个索引 */
export function avatarToIndices(a: AvatarConfig): number[] {
  return AVATAR_FIELDS.map((f) => FIELD_TO_OPTIONS[f].indexOf(a[f] as string));
}
export function avatarFromIndices(idx: ArrayLike<number>): AvatarConfig {
  const out: Record<string, unknown> = { schemaVersion: 1 };
  AVATAR_FIELDS.forEach((f, i) => { out[f] = FIELD_TO_OPTIONS[f][idx[i] ?? 0] ?? FIELD_TO_OPTIONS[f][0]; });
  return out as unknown as AvatarConfig;
}

/**
 * 画面模式角色名单（与确认画面里的小朋友同一套设定）。顺序就是新玩家的派发顺序：女、男交替。
 * 每个角色对应一组固定外观字段；图集文件名 = id。
 */
export const ROSTER = [
  { id: 'qing', name: '小晴', baseId: 'f', hairId: 'hair_bob_bangs', skinId: 'skin_02' },
  { id: 'jie', name: '阿杰', baseId: 'm', hairId: 'hair_short_curly', skinId: 'skin_02' },
  { id: 'mei', name: 'Mei', baseId: 'f', hairId: 'hair_ponytail', skinId: 'skin_02' },
  { id: 'kai', name: 'Kai', baseId: 'm', hairId: 'hair_side_part', skinId: 'skin_02' },
  { id: 'ana', name: 'Ana', baseId: 'f', hairId: 'hair_long_curly', skinId: 'skin_04' },
  { id: 'hao', name: '阿豪', baseId: 'm', hairId: 'hair_short_straight', skinId: 'skin_03' },
  { id: 'yuan', name: '圆圆', baseId: 'f', hairId: 'hair_bun', skinId: 'skin_01' },
] as const;
export type RosterId = (typeof ROSTER)[number]['id'];

/** 外观 → 名单角色：发型+性别完全对上就是它；旧存档对不上时按性别内稳定分配（不全挤到同一个） */
export function rosterOf(a: AvatarConfig): (typeof ROSTER)[number] {
  const exact = ROSTER.find((r) => r.baseId === a.baseId && r.hairId === a.hairId);
  if (exact) return exact;
  const same = ROSTER.filter((r) => r.baseId === a.baseId);
  const k = AVATAR_OPTIONS.hair.indexOf(a.hairId) + AVATAR_OPTIONS.skin.indexOf(a.skinId) * 3;
  return same[Math.abs(k) % same.length];
}

export function rosterAvatar(i: number): AvatarConfig {
  const r = ROSTER[((i % ROSTER.length) + ROSTER.length) % ROSTER.length];
  return { ...DEFAULT_AVATAR, baseId: r.baseId, hairId: r.hairId, skinId: r.skinId };
}
