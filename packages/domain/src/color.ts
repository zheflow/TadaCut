import { sampleLut, type CubeLut } from "./analysis";
/** A deterministic percentile-based starting point. It never claims to infer artistic intent. */
export function autoGrade(rgba: Uint8ClampedArray) {
  const values: number[] = [],
    sums = [0, 0, 0];
  let count = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (!rgba[i + 3]) continue;
    const rgb = [rgba[i], rgba[i + 1], rgba[i + 2]];
    rgb.forEach((v, k) => (sums[k] += v / 255));
    values.push((0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255);
    count++;
  }
  if (!count) throw new Error("没有可分析的画面像素");
  values.sort((a, b) => a - b);
  const low = values[Math.floor(values.length * 0.05)],
    high = values[Math.floor(values.length * 0.95)],
    means = sums.map((v) => v / count),
    mean = means.reduce((s, v) => s + v, 0) / 3;
  return {
    black: Math.min(0.4, low),
    white: Math.max(0.6, high),
    gamma: 1,
    gain: means.map((v) =>
      Math.max(0.7, Math.min(1.4, mean / Math.max(0.01, v))),
    ) as [number, number, number],
  };
}
/**
 * Scopes for a frame's RGBA pixels. Counts are normalized to the busiest bin
 * so the studio can draw them directly.
 */
const normalize = (values: number[]) => {
  const peak = Math.max(1, ...values);
  return values.map((v) => v / peak);
};
const lumaOf = (r: number, g: number, b: number) =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;
export function histogram(rgba: Uint8ClampedArray, bins = 64) {
  const r = new Array(bins).fill(0),
    g = new Array(bins).fill(0),
    b = new Array(bins).fill(0),
    y = new Array(bins).fill(0),
    at = (v: number) => Math.min(bins - 1, Math.floor((v / 256) * bins));
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (!rgba[i + 3]) continue;
    r[at(rgba[i])]++;
    g[at(rgba[i + 1])]++;
    b[at(rgba[i + 2])]++;
    y[at(lumaOf(rgba[i], rgba[i + 1], rgba[i + 2]))]++;
  }
  return {
    r: normalize(r),
    g: normalize(g),
    b: normalize(b),
    luma: normalize(y),
  };
}
/** Luma waveform: for each column band, how many pixels sit at each level (bottom = black). */
export function waveform(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  columns = 96,
  levels = 64,
) {
  const grid = Array.from({ length: columns }, () => new Array(levels).fill(0));
  for (let yy = 0; yy < height; yy++)
    for (let x = 0; x < width; x++) {
      const i = (yy * width + x) * 4;
      if (!rgba[i + 3]) continue;
      const column = Math.min(columns - 1, Math.floor((x / width) * columns)),
        level = Math.min(
          levels - 1,
          Math.floor(
            (lumaOf(rgba[i], rgba[i + 1], rgba[i + 2]) / 256) * levels,
          ),
        );
      grid[column][level]++;
    }
  const peak = Math.max(1, ...grid.flat());
  return grid.map((column) => column.map((v) => v / peak));
}
/** Vectorscope: pixel counts over the Cb/Cr plane, size × size, center = neutral. */
export function vectorscope(rgba: Uint8ClampedArray, size = 64) {
  const grid = new Array(size * size).fill(0);
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (!rgba[i + 3]) continue;
    const r = rgba[i] / 255,
      g = rgba[i + 1] / 255,
      b = rgba[i + 2] / 255,
      y = lumaOf(r, g, b),
      cb = (b - y) / 1.8556,
      cr = (r - y) / 1.5748,
      x = Math.min(size - 1, Math.max(0, Math.floor((cb + 0.5) * size))),
      v = Math.min(size - 1, Math.max(0, Math.floor((0.5 - cr) * size)));
    grid[v * size + x]++;
  }
  return normalize(grid);
}
/** Exposure and color facts about a frame, with plain-language notes. */
export function colorStats(rgba: Uint8ClampedArray) {
  let count = 0,
    sum = 0,
    low = 0,
    high = 0,
    sat = 0,
    warm = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (!rgba[i + 3]) continue;
    const r = rgba[i] / 255,
      g = rgba[i + 1] / 255,
      b = rgba[i + 2] / 255,
      y = lumaOf(r, g, b),
      max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    count++;
    sum += y;
    if (y < 0.02) low++;
    if (y > 0.98) high++;
    sat += max ? (max - min) / max : 0;
    warm += r - b;
  }
  if (!count) throw new Error("没有可分析的画面像素");
  const stats = {
    meanLuma: sum / count,
    shadowsClipped: low / count,
    highlightsClipped: high / count,
    saturation: sat / count,
    warmth: warm / count,
  };
  const notes: string[] = [];
  if (stats.highlightsClipped > 0.02)
    notes.push(
      `高光溢出约 ${(stats.highlightsClipped * 100).toFixed(1)}%，可降低白点或增益`,
    );
  if (stats.shadowsClipped > 0.05)
    notes.push(
      `暗部死黑约 ${(stats.shadowsClipped * 100).toFixed(1)}%，可抬起黑位`,
    );
  if (stats.meanLuma < 0.25) notes.push("整体偏暗");
  else if (stats.meanLuma > 0.72) notes.push("整体偏亮");
  if (stats.saturation < 0.12) notes.push("饱和度很低，接近黑白");
  else if (stats.saturation > 0.6) notes.push("饱和度很高，注意肤色是否失真");
  if (stats.warmth > 0.12) notes.push("偏暖");
  else if (stats.warmth < -0.12) notes.push("偏冷");
  return { ...stats, notes };
}
/** Applies a 3D LUT to RGBA pixels, for look previews and comparisons. */
export function applyLut(rgba: Uint8ClampedArray, lut: CubeLut) {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const [r, g, b] = sampleLut(lut, [
      rgba[i] / 255,
      rgba[i + 1] / 255,
      rgba[i + 2] / 255,
    ]);
    out[i] = r * 255;
    out[i + 1] = g * 255;
    out[i + 2] = b * 255;
    out[i + 3] = rgba[i + 3];
  }
  return out;
}
