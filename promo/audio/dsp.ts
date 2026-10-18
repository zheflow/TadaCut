// Small synthesis kit for the promo soundtrack: oscillators, filters and
// effects written out sample by sample, so every sound is reproducible code.
import fs from "node:fs/promises";

export const RATE = 48000;
const TAU = Math.PI * 2;

/** Seeded noise in [-1, 1), so each render of the soundtrack is identical. */
export function noise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

export const midi = (note: number) => 440 * 2 ** ((note - 69) / 12);

/** A stereo buffer that sounds are mixed into. */
export class Track {
  readonly l: Float32Array;
  readonly r: Float32Array;
  constructor(readonly length: number) {
    this.l = new Float32Array(length);
    this.r = new Float32Array(length);
  }
  /** Mixes a mono sound in at `time` seconds, equal-power panned. */
  add(time: number, sound: Float32Array, gain = 1, pan = 0) {
    const a = ((pan + 1) * Math.PI) / 4;
    this.addStereo(
      time,
      sound,
      sound,
      gain * Math.cos(a) * Math.SQRT2,
      gain * Math.sin(a) * Math.SQRT2,
    );
  }
  addStereo(
    time: number,
    left: Float32Array,
    right: Float32Array,
    gl = 1,
    gr = gl,
  ) {
    const start = Math.round(time * RATE);
    const end = Math.min(this.length, start + left.length);
    for (let j = Math.max(0, start); j < end; j++) {
      this.l[j] += left[j - start] * gl;
      this.r[j] += right[j - start] * gr;
    }
  }
  mix(source: Track, gain = 1, curve?: Float32Array) {
    for (let i = 0; i < this.length; i++) {
      const g = curve ? gain * curve[i] : gain;
      this.l[i] += source.l[i] * g;
      this.r[i] += source.r[i] * g;
    }
  }
}

function polyBlep(t: number, dt: number) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** Band-limited sawtooth. */
export class Saw {
  constructor(private phase = 0) {}
  next(freq: number) {
    const dt = freq / RATE;
    const v = 2 * this.phase - 1 - polyBlep(this.phase, dt);
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    return v;
  }
}

/** Topology-preserving state-variable filter: 0 low, 1 band, 2 high pass. */
export class Filter {
  private a = 0;
  private b = 0;
  run(x: number, cutoff: number, q: number, mode: 0 | 1 | 2 = 0) {
    const g = Math.tan((Math.PI * Math.min(cutoff, RATE * 0.45)) / RATE),
      k = 1 / q;
    const a1 = 1 / (1 + g * (g + k)),
      a2 = g * a1,
      a3 = g * a2;
    const v3 = x - this.b,
      v1 = a1 * this.a + a2 * v3,
      v2 = this.b + a2 * this.a + a3 * v3;
    this.a = 2 * v1 - this.a;
    this.b = 2 * v2 - this.b;
    return mode === 0 ? v2 : mode === 1 ? v1 : x - k * v1 - v2;
  }
}

const buffer = (seconds: number) =>
  new Float32Array(Math.round(seconds * RATE));
/** Short fade at the end of a one-shot so it never stops on a click. */
function tail(out: Float32Array, seconds = 0.01) {
  const n = Math.min(out.length, Math.round(seconds * RATE));
  for (let i = 0; i < n; i++) out[out.length - 1 - i] *= i / n;
  return out;
}

export function kick(muffled = false) {
  const out = buffer(0.42),
    rnd = noise(7),
    lp = new Filter(),
    hp = new Filter();
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    phase +=
      (TAU * (54 + 120 * Math.exp(-t * 30) + 260 * Math.exp(-t * 180))) / RATE;
    const body = Math.sin(phase) * Math.min(1, t * 1500) * Math.exp(-t * 9);
    const knock = Math.sin(phase * 2.6) * Math.exp(-t * 40) * 0.3;
    const click = hp.run(rnd(), 3000, 0.8, 2) * Math.exp(-t * 600) * 0.5;
    const v = Math.tanh((body + knock + click) * 1.5) * 0.9;
    out[i] = muffled ? lp.run(v, 420, 0.7) : v;
  }
  return tail(out);
}

export function clap(seed = 11) {
  const out = buffer(0.4),
    rnd = noise(seed),
    bp = new Filter(),
    hp = new Filter();
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    let env = t > 0.026 ? 0.55 * Math.exp(-(t - 0.026) * 16) : 0;
    for (const d of [0, 0.011, 0.022])
      if (t >= d) env = Math.max(env, Math.exp(-(t - d) * 220));
    out[i] = hp.run(bp.run(rnd(), 1300, 1.1, 1), 600, 0.7, 2) * env * 1.8;
  }
  return tail(out);
}

export function hat(open = false, seed = 3) {
  const out = buffer(open ? 0.32 : 0.07),
    rnd = noise(seed),
    hp = new Filter(),
    bp = new Filter();
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const env = Math.exp(-t * (open ? 11 : 70)) * Math.min(1, t * 4000);
    const x = hp.run(rnd(), 7500, 0.8, 2);
    out[i] = (x * 0.8 + bp.run(x, 10000, 2, 1) * 0.6) * env;
  }
  return tail(out);
}

export function bass(freq: number, length: number) {
  const out = buffer(length + 0.05),
    saw = new Saw(),
    lp = new Filter();
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    phase += (TAU * freq) / RATE;
    const env =
      Math.min(1, t / 0.004) *
      (1 - 0.25 * Math.min(1, t / 0.2)) *
      (t < length ? 1 : Math.max(0, 1 - (t - length) / 0.05));
    const body =
      Math.sin(phase) * 0.65 +
      0.7 * lp.run(saw.next(freq), 520 + 1600 * Math.exp(-t * 12), 1.1);
    out[i] = Math.tanh(body * 1.4) * env * 0.8;
  }
  return out;
}

/** Detuned saws, one set per side, through a slowly moving low pass. */
export function pad(
  notes: number[],
  length: number,
  bright = 1,
): [Float32Array, Float32Array] {
  const left = buffer(length + 0.9),
    right = buffer(length + 0.9);
  const voices = notes.flatMap((note, i) =>
    [-1, 1].map((side) => ({
      freq: midi(note) * 2 ** ((side * (6 + i)) / 1200),
      saw: new Saw((i * 0.37 + (side > 0 ? 0.5 : 0)) % 1),
      side,
    })),
  );
  const f = [new Filter(), new Filter(), new Filter(), new Filter()];
  for (let i = 0; i < left.length; i++) {
    const t = i / RATE;
    const env =
      Math.min(1, t / 0.35) * (t < length ? 1 : Math.exp(-(t - length) / 0.25));
    let l = 0,
      r = 0;
    for (const v of voices) {
      const s = v.saw.next(v.freq);
      if (v.side < 0) l += s;
      else r += s;
    }
    const cutoff = (1700 + 800 * Math.sin(t * 1.1)) * bright;
    left[i] = f[1].run(f[0].run(l, cutoff, 0.7), cutoff, 0.7) * env * 0.12;
    right[i] = f[3].run(f[2].run(r, cutoff, 0.7), cutoff, 0.7) * env * 0.12;
  }
  return [left, right];
}

export function pluck(freq: number, decay = 0.3, tone = 1) {
  const out = buffer(Math.min(1.4, decay * 4.5)),
    a = new Saw(0),
    b = new Saw(0.3),
    lp = new Filter();
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.002) * Math.exp(-t / decay);
    const x = a.next(freq) * 0.6 + b.next(freq * 1.005) * 0.4;
    out[i] =
      lp.run(x, (420 + 5200 * Math.exp(-t * 16)) * tone, 1.1) * env * 0.5;
  }
  return tail(out);
}

/** A soft FM bell. */
export function bell(freq: number, decay = 0.9) {
  const out = buffer(decay * 4);
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const mod = Math.sin(TAU * freq * 3.5 * t) * 2.2 * Math.exp(-t * 6);
    const env = Math.min(1, t / 0.003) * Math.exp(-t / decay);
    out[i] =
      (Math.sin(TAU * freq * t + mod) * 0.8 +
        Math.sin(TAU * freq * 2 * t) * 0.15 * Math.exp(-t * 3)) *
      env *
      0.45;
  }
  return tail(out);
}

/** Noise that opens upward over `length`, ending exactly on the next downbeat. */
export function riser(length: number) {
  const out = buffer(length),
    rnd = noise(21),
    bp = new Filter();
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE,
      p = t / length;
    const x = bp.run(rnd(), 300 * 30 ** p, 1.6, 1);
    phase += (TAU * (180 + 900 * p * p)) / RATE;
    out[i] = (x * 1.2 + Math.sin(phase) * 0.12) * p * p * 0.5;
  }
  return tail(out, 0.02);
}

/** Air moving past from left to right. */
export function whoosh(length = 0.55, seed = 31): [Float32Array, Float32Array] {
  const left = buffer(length),
    right = buffer(length),
    rnd = noise(seed),
    a = new Filter(),
    b = new Filter();
  for (let i = 0; i < left.length; i++) {
    const p = i / left.length;
    const env = Math.sin(Math.PI * p) ** 1.6;
    const cutoff = 350 * 14 ** Math.sin(Math.PI * p * 0.9);
    const x = b.run(a.run(rnd(), cutoff, 0.9, 1), cutoff, 0.9, 1) * env;
    const angle = ((0.3 + 1.4 * p) * Math.PI) / 4;
    left[i] = x * Math.cos(angle) * 1.6;
    right[i] = x * Math.sin(angle) * 1.6;
  }
  return [left, right];
}

/** Sub drop, thud and a washy crash for the big downbeats. */
export function impact() {
  const out = buffer(2.2),
    rnd = noise(41),
    hp = new Filter(),
    lp = new Filter();
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    phase += (TAU * (44 + 50 * Math.exp(-t * 9))) / RATE;
    const boom = Math.sin(phase) * Math.exp(-t * 3) * Math.min(1, t * 800);
    const crash = hp.run(rnd(), 2800, 0.7, 2) * Math.exp(-t * 2.2) * 0.5;
    const thud = lp.run(rnd(), 180, 0.8) * Math.exp(-t * 18) * 0.8;
    out[i] = Math.tanh((boom * 0.9 + crash + thud) * 1.2) * 0.85;
  }
  return tail(out, 0.05);
}

/** Interface click: a short tone with a crisp edge. */
export function click(freq = 2400, seed = 53) {
  const out = buffer(0.05),
    rnd = noise(seed),
    hp = new Filter();
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    out[i] =
      Math.sin(TAU * freq * t) * Math.exp(-t * 260) * 0.6 +
      hp.run(rnd(), 4000, 0.7, 2) * Math.exp(-t * 900) * 0.5;
  }
  return tail(out);
}

/** One key of a soft keyboard. */
export function key(seed: number) {
  const out = buffer(0.035),
    rnd = noise(seed),
    bp = new Filter();
  const tone = 2600 + (seed % 7) * 260;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    out[i] =
      bp.run(rnd(), tone, 1.8, 1) * Math.exp(-t * 520) * 2.2 +
      Math.sin(TAU * 170 * t) * Math.exp(-t * 140) * 0.15;
  }
  return tail(out);
}

/** Gain curve that ducks after each kick, for the pumping pad and bass. */
export function duck(
  length: number,
  hits: number[],
  depth = 0.55,
  release = 0.16,
) {
  const gain = new Float32Array(length).fill(1);
  for (const hit of hits) {
    const start = Math.round(hit * RATE),
      n = Math.round(release * 5 * RATE);
    for (let i = 0; i < n; i++) {
      const j = start + i;
      if (j < 0 || j >= length) continue;
      const t = i / RATE;
      gain[j] = Math.min(
        gain[j],
        1 - depth * Math.min(1, t / 0.004) * Math.exp(-t / release),
      );
    }
  }
  return gain;
}

class Comb {
  private buf: Float32Array;
  private i = 0;
  private store = 0;
  constructor(
    size: number,
    private feedback: number,
    private damp: number,
  ) {
    this.buf = new Float32Array(size);
  }
  run(x: number) {
    const y = this.buf[this.i];
    this.store = y * (1 - this.damp) + this.store * this.damp;
    this.buf[this.i] = x + this.store * this.feedback;
    if (++this.i >= this.buf.length) this.i = 0;
    return y;
  }
}
class Allpass {
  private buf: Float32Array;
  private i = 0;
  constructor(size: number) {
    this.buf = new Float32Array(size);
  }
  run(x: number) {
    const b = this.buf[this.i];
    this.buf[this.i] = x + b * 0.5;
    if (++this.i >= this.buf.length) this.i = 0;
    return b - x;
  }
}

/** Schroeder–Moorer reverb with the classic Freeverb tunings. */
export function reverb(source: Track, room = 0.84, damp = 0.25) {
  const scale = RATE / 44100;
  const make = (spread: number) => ({
    combs: [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(
      (s) => new Comb(Math.round((s + spread) * scale), room, damp),
    ),
    passes: [556, 441, 341, 225].map(
      (s) => new Allpass(Math.round((s + spread) * scale)),
    ),
  });
  const L = make(0),
    R = make(23),
    out = new Track(source.length);
  for (let i = 0; i < source.length; i++) {
    const input = (source.l[i] + source.r[i]) * 0.015;
    let l = 0,
      r = 0;
    for (const c of L.combs) l += c.run(input);
    for (const c of R.combs) r += c.run(input);
    for (const a of L.passes) l = a.run(l);
    for (const a of R.passes) r = a.run(r);
    out.l[i] = l * 3;
    out.r[i] = r * 3;
  }
  return out;
}

/** Echoes that bounce left, right, left, each a little darker. */
export function pingPong(
  source: Track,
  seconds: number,
  feedback = 0.38,
  tone = 3200,
) {
  const d = Math.round(seconds * RATE),
    bl = new Float32Array(d),
    br = new Float32Array(d),
    fl = new Filter(),
    fr = new Filter(),
    out = new Track(source.length);
  let i0 = 0;
  for (let i = 0; i < source.length; i++) {
    const dl = bl[i0],
      dr = br[i0];
    out.l[i] = dl;
    out.r[i] = dr;
    bl[i0] = fl.run(
      (source.l[i] + source.r[i]) * 0.5 + dr * feedback,
      tone,
      0.7,
    );
    br[i0] = fr.run(dl * feedback, tone, 0.7);
    if (++i0 >= d) i0 = 0;
  }
  return out;
}

export function stats(track: Track) {
  let peak = 0,
    sum = 0;
  for (let i = 0; i < track.length; i++) {
    peak = Math.max(peak, Math.abs(track.l[i]), Math.abs(track.r[i]));
    sum += track.l[i] ** 2 + track.r[i] ** 2;
  }
  const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-9));
  return { peakDb: db(peak), rmsDb: db(Math.sqrt(sum / (2 * track.length))) };
}

/** 16-bit stereo PCM. */
export async function writeWav(file: string, track: Track) {
  const n = track.length,
    out = Buffer.alloc(44 + n * 4);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + n * 4, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(2, 22);
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 4, 28);
  out.writeUInt16LE(4, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    out.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, track.l[i])) * 32767),
      44 + i * 4,
    );
    out.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, track.r[i])) * 32767),
      46 + i * 4,
    );
  }
  await fs.writeFile(file, out);
}
