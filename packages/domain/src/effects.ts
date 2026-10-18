import type { CubeLut } from "./analysis";
import { transitionKinds, type TransitionKind } from "./model";

/**
 * Library effects. The catalog describes each effect and its parameters; the
 * renderer owns the shader for each id. Parameters are plain numbers so they
 * validate, animate and serialize like every other clip property.
 */
export interface EffectParam {
  key: string;
  name: string;
  min: number;
  max: number;
  default: number;
  step?: number;
}
export interface EffectPreset {
  id: string;
  name: string;
  category: "stylize" | "distort" | "light" | "color" | "blur" | "retro";
  description: string;
  params: EffectParam[];
  /** Changes over time even when its parameters stay the same. */
  animated?: boolean;
}
const param = (
  key: string,
  name: string,
  min: number,
  max: number,
  value: number,
  step?: number,
): EffectParam => ({ key, name, min, max, default: value, step });
export const effectPresets: EffectPreset[] = [
  {
    id: "pixelate",
    name: "像素化",
    category: "stylize",
    description: "把画面变成方块像素，可用于打码或复古风格。",
    params: [param("size", "块大小", 2, 120, 16, 1)],
  },
  {
    id: "duotone",
    name: "双色调",
    category: "color",
    description: "用两种颜色重新映射明暗，适合海报感画面。",
    params: [
      param("shadowHue", "暗部色相", 0, 360, 230, 1),
      param("highlightHue", "亮部色相", 0, 360, 40, 1),
      param("amount", "强度", 0, 1, 1, 0.01),
    ],
  },
  {
    id: "fisheye",
    name: "鱼眼",
    category: "distort",
    description: "中心膨胀或收缩的镜头畸变。",
    params: [param("strength", "强度", -1, 1, 0.5, 0.01)],
  },
  {
    id: "kaleidoscope",
    name: "万花筒",
    category: "distort",
    description: "把画面切成扇区并镜像拼合。",
    params: [
      param("segments", "扇区数", 2, 16, 6, 1),
      param("rotation", "旋转", 0, 360, 0, 1),
    ],
  },
  {
    id: "soft-glow",
    name: "柔光",
    category: "light",
    description: "亮部向外晕开，画面更柔和梦幻。",
    params: [
      param("radius", "范围", 1, 40, 12, 1),
      param("strength", "强度", 0, 2, 0.6, 0.01),
      param("threshold", "亮度阈值", 0, 1, 0.6, 0.01),
    ],
  },
  {
    id: "light-leak",
    name: "漏光",
    category: "light",
    description: "胶片边缘漂移的暖色漏光。",
    params: [
      param("intensity", "强度", 0, 1, 0.5, 0.01),
      param("hue", "色相", 0, 360, 25, 1),
      param("speed", "速度", 0, 3, 0.6, 0.01),
    ],
    animated: true,
  },
  {
    id: "glitch",
    name: "故障",
    category: "retro",
    description: "随机的横向错位和色彩分离。",
    params: [
      param("amount", "强度", 0, 1, 0.4, 0.01),
      param("speed", "频率", 0, 6, 2, 0.01),
    ],
    animated: true,
  },
  {
    id: "vignette",
    name: "暗角",
    category: "light",
    description: "四周压暗，视线集中到画面中心。",
    params: [
      param("amount", "强度", 0, 1, 0.5, 0.01),
      param("softness", "柔和度", 0.05, 1, 0.5, 0.01),
    ],
  },
  {
    id: "film-grain",
    name: "胶片颗粒",
    category: "retro",
    description: "逐帧变化的细小颗粒。",
    params: [
      param("amount", "强度", 0, 1, 0.25, 0.01),
      param("size", "颗粒大小", 1, 4, 1.5, 0.1),
    ],
    animated: true,
  },
  {
    id: "chromatic-aberration",
    name: "色散",
    category: "distort",
    description: "红蓝通道向边缘错开，像廉价镜头的色边。",
    params: [param("offset", "偏移（像素）", 0, 30, 6, 0.5)],
  },
  {
    id: "sharpen",
    name: "锐化",
    category: "blur",
    description: "加强边缘细节。",
    params: [param("amount", "强度", 0, 3, 0.8, 0.01)],
  },
  {
    id: "posterize",
    name: "色调分离",
    category: "stylize",
    description: "减少色阶，形成平涂效果。",
    params: [param("levels", "色阶", 2, 16, 5, 1)],
  },
  {
    id: "halftone",
    name: "半调网点",
    category: "stylize",
    description: "印刷网点风格。",
    params: [
      param("size", "网点间距", 3, 40, 8, 1),
      param("angle", "角度", 0, 90, 45, 1),
    ],
  },
  {
    id: "sketch",
    name: "线稿",
    category: "stylize",
    description: "提取边缘，像铅笔素描。",
    params: [param("strength", "强度", 0.2, 4, 1.5, 0.01)],
  },
  {
    id: "mirror",
    name: "镜像",
    category: "distort",
    description: "左右或上下对称。",
    params: [param("axis", "方向（0 左右 / 1 上下）", 0, 1, 0, 1)],
  },
  {
    id: "wave",
    name: "波浪",
    category: "distort",
    description: "水面般起伏的扭曲。",
    params: [
      param("amplitude", "幅度", 0, 0.05, 0.01, 0.001),
      param("frequency", "频率", 1, 40, 12, 0.1),
      param("speed", "速度", 0, 6, 1.5, 0.01),
    ],
    animated: true,
  },
  {
    id: "scanlines",
    name: "扫描线",
    category: "retro",
    description: "老电视的横向扫描线和轻微闪烁。",
    params: [
      param("amount", "强度", 0, 1, 0.35, 0.01),
      param("density", "密度", 100, 1200, 540, 1),
    ],
    animated: true,
  },
  {
    id: "tilt-shift",
    name: "移轴",
    category: "blur",
    description: "上下虚化，制造微缩模型感。",
    params: [
      param("focus", "清晰带位置", 0, 1, 0.5, 0.01),
      param("width", "清晰带宽度", 0.02, 0.8, 0.2, 0.01),
      param("blur", "虚化", 0, 20, 8, 0.1),
    ],
  },
  {
    id: "zoom-blur",
    name: "径向模糊",
    category: "blur",
    description: "从中心向外的速度感模糊。",
    params: [param("amount", "强度", 0, 0.4, 0.1, 0.005)],
  },
  {
    id: "hue-shift",
    name: "色相偏移",
    category: "color",
    description: "整体旋转色相。",
    params: [param("degrees", "角度", -180, 180, 30, 1)],
  },
  {
    id: "temperature",
    name: "色温色调",
    category: "color",
    description: "偏暖 / 偏冷，偏绿 / 偏品。",
    params: [
      param("temperature", "色温", -1, 1, 0.2, 0.01),
      param("tint", "色调", -1, 1, 0, 0.01),
    ],
  },
  {
    id: "black-white",
    name: "黑白",
    category: "color",
    description: "按通道权重转黑白，可调反差。",
    params: [
      param("contrast", "反差", 0.5, 2, 1.15, 0.01),
      param("red", "红色权重", 0, 1, 0.3, 0.01),
      param("green", "绿色权重", 0, 1, 0.59, 0.01),
      param("blue", "蓝色权重", 0, 1, 0.11, 0.01),
    ],
  },
  {
    id: "invert",
    name: "反相",
    category: "color",
    description: "颜色取反，可部分混合。",
    params: [param("amount", "强度", 0, 1, 1, 0.01)],
  },
];
export const effectCategories: Record<EffectPreset["category"], string> = {
  stylize: "风格化",
  distort: "扭曲",
  light: "光效",
  color: "色彩",
  blur: "模糊与锐化",
  retro: "复古",
};
export const findEffect = (id: string) =>
  effectPresets.find((e) => e.id === id);
/** A preset's parameters with defaults filled in; unknown ids or keys and out-of-range values are errors. */
export function effectParams(
  id: string,
  params: Record<string, number> = {},
): Record<string, number> {
  const preset = findEffect(id);
  if (!preset) throw new Error(`没有这个特效：${id}`);
  for (const key of Object.keys(params))
    if (!preset.params.some((p) => p.key === key))
      throw new Error(`特效「${preset.name}」没有参数 ${key}`);
  return Object.fromEntries(
    preset.params.map((p) => {
      const value = params[p.key] ?? p.default;
      if (!Number.isFinite(value) || value < p.min || value > p.max)
        throw new Error(
          `特效「${preset.name}」的${p.name}需要在 ${p.min} 到 ${p.max} 之间`,
        );
      return [p.key, value];
    }),
  );
}

export interface TransitionInfo {
  name: string;
  category: "basic" | "shape" | "stylize" | "motion";
  /** Accepts a direction (left / right / up / down). */
  directional?: boolean;
  /** Needs the WebGL renderer; text and animation layers fall back to a dissolve. */
  gl?: boolean;
}
export const transitionCatalog: Record<TransitionKind, TransitionInfo> = {
  dissolve: { name: "交叉溶解", category: "basic" },
  fade: { name: "淡出", category: "basic" },
  dip: { name: "闪黑", category: "basic" },
  flash: { name: "闪白", category: "basic" },
  wipe: { name: "擦除", category: "shape", directional: true },
  "soft-wipe": { name: "柔边擦除", category: "shape", directional: true },
  slide: { name: "滑动", category: "motion", directional: true },
  circle: { name: "圆形展开", category: "shape" },
  diamond: { name: "菱形展开", category: "shape" },
  clock: { name: "时钟擦除", category: "shape" },
  blinds: { name: "百叶窗", category: "shape", directional: true },
  checker: { name: "棋盘格", category: "shape" },
  noise: { name: "噪点溶解", category: "stylize", gl: true },
  pixelate: { name: "像素化", category: "stylize", gl: true },
  zoom: { name: "缩放推进", category: "motion" },
  spin: { name: "旋转", category: "motion" },
  glitch: { name: "故障", category: "stylize", gl: true },
  ripple: { name: "水波", category: "stylize", gl: true },
};
export const transitionList = transitionKinds.map((kind) => ({
  kind,
  ...transitionCatalog[kind],
}));

/**
 * Color looks generated from simple grading operations, so every LUT is
 * original and reproducible. Each look maps linear-ish 0–1 RGB to RGB.
 */
type Rgb = [number, number, number];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const luma = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const saturate = (c: Rgb, amount: number): Rgb => {
  const y = luma(c);
  return c.map((v) => y + (v - y) * amount) as Rgb;
};
/** S-curve around a pivot; amount 0 is identity. */
const contrast = (c: Rgb, amount: number, pivot = 0.45): Rgb =>
  c.map((v) => {
    const x = v - pivot;
    return pivot + x * (1 + amount) - amount * x * x * x * 2.2;
  }) as Rgb;
const lift = (c: Rgb, black: number): Rgb =>
  c.map((v) => black + v * (1 - black)) as Rgb;
const tone = (c: Rgb, shadows: Rgb, highlights: Rgb, balance = 0.5): Rgb => {
  const y = luma(c),
    s = clamp01(1 - y / balance),
    h = clamp01((y - balance) / (1 - balance));
  return c.map((v, i) => v + shadows[i] * s + highlights[i] * h) as Rgb;
};
const hueOf = (degrees: number, amount: number): Rgb => {
  const a = (degrees * Math.PI) / 180;
  return [
    Math.cos(a) * amount,
    Math.cos(a - (2 * Math.PI) / 3) * amount,
    Math.cos(a + (2 * Math.PI) / 3) * amount,
  ];
};
export const looks = {
  "teal-orange": {
    name: "青橙",
    description: "暗部偏青、肤色偏暖的电影感。",
    map: (c: Rgb) =>
      saturate(
        contrast(tone(c, hueOf(195, 0.06), hueOf(30, 0.05)), 0.18),
        1.12,
      ),
  },
  "warm-film": {
    name: "暖调胶片",
    description: "抬起的黑位、柔和高光和暖色偏移。",
    map: (c: Rgb) =>
      lift(
        saturate(
          contrast(tone(c, [0.02, 0.01, -0.02], [0.05, 0.02, -0.03]), 0.1),
          0.92,
        ),
        0.05,
      ),
  },
  "cool-night": {
    name: "冷夜",
    description: "压低亮度、偏蓝的夜色。",
    map: (c: Rgb) =>
      saturate(
        contrast(
          tone(
            c.map((v) => v * 0.88) as Rgb,
            [-0.02, 0.01, 0.07],
            [-0.02, 0.01, 0.04],
          ),
          0.15,
        ),
        0.85,
      ),
  },
  "vintage-fade": {
    name: "褪色复古",
    description: "褪色的黑位，偏黄绿的老照片。",
    map: (c: Rgb) =>
      lift(
        saturate(
          tone(contrast(c, -0.12), [0.03, 0.04, -0.01], [0.04, 0.03, -0.05]),
          0.75,
        ),
        0.1,
      ),
  },
  "bleach-bypass": {
    name: "漂白",
    description: "低饱和、高反差的金属质感。",
    map: (c: Rgb) => saturate(contrast(c, 0.35), 0.45),
  },
  "mono-contrast": {
    name: "高反差黑白",
    description: "偏重红通道的黑白。",
    map: (c: Rgb) => {
      const y = 0.4 * c[0] + 0.5 * c[1] + 0.1 * c[2];
      return contrast([y, y, y], 0.35);
    },
  },
  pastel: {
    name: "柔和粉彩",
    description: "提亮、低反差、偏粉的清新色调。",
    map: (c: Rgb) =>
      lift(
        saturate(
          tone(contrast(c, -0.15), [0.03, 0.0, 0.04], [0.03, 0.01, 0.02]),
          0.85,
        ),
        0.06,
      ),
  },
  "fresh-japan": {
    name: "清透日系",
    description: "通透的高调画面，微微偏青。",
    map: (c: Rgb) =>
      lift(
        saturate(
          tone(
            contrast(c.map((v) => Math.pow(v, 0.88)) as Rgb, -0.1),
            [-0.01, 0.02, 0.03],
            [-0.01, 0.01, 0.01],
          ),
          0.9,
        ),
        0.04,
      ),
  },
  "golden-hour": {
    name: "金色时刻",
    description: "傍晚般的金色高光。",
    map: (c: Rgb) =>
      saturate(
        contrast(tone(c, [0.02, 0.0, -0.03], [0.08, 0.04, -0.05], 0.4), 0.12),
        1.08,
      ),
  },
  "forest-green": {
    name: "森系",
    description: "偏绿的中间调，安静自然。",
    map: (c: Rgb) =>
      saturate(
        tone(contrast(c, 0.05), [-0.01, 0.03, 0.0], [0.01, 0.03, -0.02], 0.55),
        0.88,
      ),
  },
  neon: {
    name: "霓虹",
    description: "洋红与青色的高饱和夜景。",
    map: (c: Rgb) =>
      saturate(
        contrast(tone(c, hueOf(300, 0.07), hueOf(185, 0.06)), 0.22),
        1.3,
      ),
  },
  "flat-log": {
    name: "电影灰",
    description: "降低反差和饱和，留给后续调色。",
    map: (c: Rgb) =>
      lift(saturate(contrast(c, -0.3), 0.75), 0.08).map((v) =>
        mix(v, 0.5, 0.05),
      ) as Rgb,
  },
} satisfies Record<
  string,
  { name: string; description: string; map: (c: Rgb) => Rgb }
>;
export type LookId = keyof typeof looks;
/** A 3D LUT for a look, at an intensity from 0 (identity) to 1. */
export function generateLook(id: LookId, size = 25, intensity = 1): CubeLut {
  const look = looks[id];
  if (!look) throw new Error(`没有这个风格：${id}`);
  const values = new Float32Array(size ** 3 * 3);
  let i = 0;
  // .cube order: red changes fastest, then green, then blue.
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const input: Rgb = [r / (size - 1), g / (size - 1), b / (size - 1)],
          output = look.map(input);
        for (let k = 0; k < 3; k++)
          values[i++] = clamp01(mix(input[k], output[k], intensity));
      }
  return {
    size,
    values,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    title: look.name,
  };
}
export function serializeCube(lut: CubeLut) {
  const lines = [
    `TITLE "${lut.title.replace(/"/g, "'")}"`,
    `LUT_3D_SIZE ${lut.size}`,
    `DOMAIN_MIN ${lut.domainMin.join(" ")}`,
    `DOMAIN_MAX ${lut.domainMax.join(" ")}`,
  ];
  for (let i = 0; i < lut.values.length; i += 3)
    lines.push(
      `${lut.values[i].toFixed(6)} ${lut.values[i + 1].toFixed(6)} ${lut.values[i + 2].toFixed(6)}`,
    );
  return lines.join("\n") + "\n";
}
