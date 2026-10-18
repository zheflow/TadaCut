export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] ** 2;
    bb += b[i] ** 2;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
export function analyzePcm(
  samples: Float32Array,
  sampleRate: number,
  points = 600,
) {
  if (!sampleRate || !samples.length) throw new Error("音频为空");
  const waveform: number[] = [];
  const block = Math.max(1, Math.ceil(samples.length / points));
  let energy = 0,
    peak = 0;
  for (let i = 0; i < samples.length; i += block) {
    let maximum = 0;
    for (let j = i; j < Math.min(i + block, samples.length); j++) {
      const v = Math.abs(samples[j]);
      maximum = Math.max(maximum, v);
      peak = Math.max(peak, v);
      energy += v * v;
    }
    waveform.push(maximum);
  }
  const rms = Math.sqrt(energy / samples.length);
  const hop = Math.max(1, Math.round(sampleRate * 0.02));
  const envelopes: number[] = [];
  for (let i = 0; i < samples.length; i += hop) {
    let e = 0;
    for (let j = i; j < Math.min(i + hop, samples.length); j++)
      e += samples[j] ** 2;
    envelopes.push(Math.sqrt(e / Math.min(hop, samples.length - i)));
  }
  return {
    waveform,
    rms,
    peak,
    rmsDb: 20 * Math.log10(Math.max(rms, 1e-9)),
    duration: samples.length / sampleRate,
    envelopes,
    envelopeRate: sampleRate / hop,
  };
}
export function detectSilence(
  envelopes: number[],
  rate: number,
  thresholdDb = -38,
  minDuration = 0.3,
) {
  const threshold = 10 ** (thresholdDb / 20);
  const regions: { start: number; end: number }[] = [];
  let start: number | null = null;
  for (let i = 0; i <= envelopes.length; i++) {
    if (i < envelopes.length && envelopes[i] < threshold) {
      if (start === null) start = i;
    } else if (start !== null) {
      if ((i - start) / rate >= minDuration)
        regions.push({ start: start / rate, end: i / rate });
      start = null;
    }
  }
  return regions;
}
export function detectBeats(envelopes: number[], rate: number) {
  if (envelopes.length < rate * 2)
    return { bpm: 0, beats: [] as number[], confidence: 0 };
  const onset = envelopes.map((e, i) =>
    Math.max(0, e - (envelopes[i - 1] ?? e)),
  );
  let best = 0,
    lag = 0;
  for (
    let candidate = Math.round((rate * 60) / 180);
    candidate <= Math.round((rate * 60) / 60);
    candidate++
  ) {
    let score = 0;
    for (let i = candidate; i < onset.length; i++)
      score += onset[i] * onset[i - candidate];
    if (score > best) {
      best = score;
      lag = candidate;
    }
  }
  if (!lag || !best) return { bpm: 0, beats: [] as number[], confidence: 0 };
  let phase = 0,
    phaseScore = 0;
  for (let i = 0; i < lag; i++) {
    let score = 0;
    for (let j = i; j < onset.length; j += lag) score += onset[j];
    if (score > phaseScore) {
      phaseScore = score;
      phase = i;
    }
  }
  const beats = [];
  for (let i = phase; i < envelopes.length; i += lag) beats.push(i / rate);
  const total = onset.reduce((s, v) => s + v * v, 0);
  return {
    bpm: Math.round((60 * rate) / lag),
    beats,
    confidence: Math.min(1, best / Math.max(total, 1e-9)),
  };
}
/** Positive offset means the candidate starts later than the reference. */
export function alignAudio(
  reference: number[],
  candidate: number[],
  rate: number,
  maxOffsetSeconds = 30,
) {
  if (reference.length < 20 || candidate.length < 20)
    throw new Error("同步至少需要可辨识的音频");
  const maxLag = Math.round(
    Math.min(
      maxOffsetSeconds * rate,
      Math.max(reference.length, candidate.length) - 20,
    ),
  );
  const normalize = (x: number[]) => {
    const mean = x.reduce((a, b) => a + b, 0) / x.length;
    return x.map((v) => v - mean);
  };
  const a = normalize(reference),
    b = normalize(candidate);
  let best = -Infinity,
    bestLag = 0;
  const stride = Math.max(1, Math.floor(Math.min(a.length, b.length) / 4000));
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let dot = 0,
      aa = 0,
      bb = 0,
      count = 0;
    for (
      let i = Math.max(0, lag);
      i < Math.min(a.length, b.length + lag);
      i += stride
    ) {
      const x = a[i],
        y = b[i - lag];
      dot += x * y;
      aa += x * x;
      bb += y * y;
      count++;
    }
    const score = count > 20 && aa && bb ? dot / Math.sqrt(aa * bb) : -1;
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  return { offsetSeconds: bestLag / rate, confidence: Math.max(0, best) };
}
export interface CubeLut {
  size: number;
  values: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  title: string;
}
export function parseCube(text: string): CubeLut {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);
  let size = 0,
    title = "自定义 LUT";
  let domainMin: CubeLut["domainMin"] = [0, 0, 0],
    domainMax: CubeLut["domainMax"] = [1, 1, 1];
  const values: number[] = [];
  for (const row of rows) {
    const [name, ...rest] = row.split(/\s+/);
    if (name === "TITLE") title = rest.join(" ").replace(/^"|"$/g, "");
    else if (name === "LUT_3D_SIZE") size = Number(rest[0]);
    else if (name === "DOMAIN_MIN")
      domainMin = rest.map(Number) as CubeLut["domainMin"];
    else if (name === "DOMAIN_MAX")
      domainMax = rest.map(Number) as CubeLut["domainMax"];
    else if (name === "LUT_1D_SIZE") throw new Error("请选择 3D .cube LUT");
    else if (/^[-+.\d]/.test(name)) {
      const n = [name, ...rest].map(Number);
      if (n.length !== 3 || n.some((v) => !Number.isFinite(v)))
        throw new Error("LUT 数据无效");
      values.push(...n);
    }
  }
  if (
    !Number.isInteger(size) ||
    size < 2 ||
    size > 65 ||
    values.length !== size ** 3 * 3
  )
    throw new Error("LUT 尺寸与数据数量不一致");
  if (
    domainMin.length !== 3 ||
    domainMax.length !== 3 ||
    domainMax.some((v, i) => !Number.isFinite(v) || v <= domainMin[i])
  )
    throw new Error("LUT domain 无效");
  return {
    size,
    values: new Float32Array(values),
    domainMin,
    domainMax,
    title,
  };
}
export function sampleLut(
  lut: CubeLut,
  rgb: [number, number, number],
): [number, number, number] {
  const pos = rgb.map(
    (v, i) =>
      Math.max(
        0,
        Math.min(
          1,
          (v - lut.domainMin[i]) / (lut.domainMax[i] - lut.domainMin[i]),
        ),
      ) *
      (lut.size - 1),
  );
  const lo = pos.map(Math.floor),
    hi = lo.map((v) => Math.min(lut.size - 1, v + 1)),
    f = pos.map((v, i) => v - lo[i]);
  const out = [0, 0, 0];
  for (let r = 0; r <= 1; r++)
    for (let g = 0; g <= 1; g++)
      for (let b = 0; b <= 1; b++) {
        const x = r ? hi[0] : lo[0],
          y = g ? hi[1] : lo[1],
          z = b ? hi[2] : lo[2];
        const weight =
          (r ? f[0] : 1 - f[0]) * (g ? f[1] : 1 - f[1]) * (b ? f[2] : 1 - f[2]);
        const index = (z * lut.size * lut.size + y * lut.size + x) * 3;
        for (let k = 0; k < 3; k++) out[k] += lut.values[index + k] * weight;
      }
  return out as [number, number, number];
}
