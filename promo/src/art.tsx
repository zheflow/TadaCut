// Four illustrated "shots" for the promo's sample project, drawn as layered
// SVG so they can drift, shimmer and be cropped like real footage.
import React, { useId } from "react";
import { useCurrentFrame } from "remotion";
import { FPS } from "./timeline";

const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
// Layers run past the frame so parallax drift never reveals an edge.
const X0 = -400,
  X1 = 2320,
  SPAN = X1 - X0;
const n = (v: number) => v.toFixed(1);
const bell = (x: number, c: number, s: number) =>
  Math.exp(-(((x - c) / s) ** 2));
type Line = (x: number) => number;

/**
 * Rolling or peaked ridge line: a few octaves of sines, the upper ones
 * creased, plus `lift` bumps [x, spread, height] that place the big peaks.
 */
function ridge(
  seed: number,
  base: number,
  amp: number,
  peaks = 0.4,
  lift: number[][] = [],
): Line {
  const r = rng(seed);
  const waves = Array.from({ length: 5 }, (_, i) => ({
    f: (0.0016 + r() * 0.001) * 2.1 ** i,
    p: r() * Math.PI * 2,
    a: amp * 0.5 ** i,
  }));
  return (x) =>
    base -
    lift.reduce((y, [c, s, h]) => y + h * bell(x, c, s), 0) -
    waves.reduce(
      (y, w, i) =>
        y +
        (i === 0
          ? w.a * Math.sin(x * w.f + w.p)
          : w.a *
            ((1 - peaks) * Math.sin(x * w.f + w.p) +
              peaks * (1 - 2 * Math.abs(Math.sin(x * w.f + w.p))))),
      0,
    );
}
const fill = (y: Line, bottom = 1200, step = 16) => {
  let d = `M${X0} ${bottom}`;
  for (let x = X0; x <= X1; x += step) d += `L${x} ${n(y(x))}`;
  return d + `L${X1} ${bottom}Z`;
};
const crest = (y: Line, step = 12) => {
  let d = "";
  for (let x = X0; x <= X1; x += step) d += `${d ? "L" : "M"}${x} ${n(y(x))}`;
  return d;
};
/** Snow from a ridge down to a ragged line, wherever the ridge climbs above it. */
function snow(y: Line, line: number) {
  let top = "",
    under = "";
  for (let x = X0; x <= X1; x += 8) {
    const r = y(x),
      edge = line + 14 * Math.sin(x * 0.043) + 8 * Math.sin(x * 0.11 + 1);
    top += `${top ? "L" : "M"}${x} ${n(r)}`;
    under = `L${x} ${n(Math.min(r + 70, Math.max(r, edge)))}` + under;
  }
  return top + under + "Z";
}
/** Patches of small conifers standing on a ridge. */
function forest(seed: number, y: Line, min: number, max: number) {
  const r = rng(seed);
  let d = "";
  for (let x = X0; x < X1; x += 5 + r() * 9) {
    const h = min + r() * (max - min),
      b = y(x) + 3 + r() * h * 0.45;
    if (Math.sin(x * 0.0041 + seed) < -0.3) continue;
    d += `M${n(x)} ${n(b - h)}L${n(x + h * 0.21)} ${n(b)}H${n(x - h * 0.21)}Z`;
  }
  return d;
}
/** A tiered pine standing at (x, base), about `h` tall. */
function pine(x: number, base: number, h: number) {
  const w = h * 0.4;
  let d = `M${n(x - 3)} ${n(base)}h6v${n(-h * 0.16)}h-6Z`;
  for (let i = 0; i < 5; i++) {
    const top = base - h * (0.38 + i * 0.16),
      bw = w * (1 - i * 0.17);
    d += `M${n(x)} ${n(top)}L${n(x + bw / 2)} ${n(top + h * 0.3)}H${n(x - bw / 2)}Z`;
  }
  return d;
}
const star = (x: number, y: number, s: number) =>
  `M${n(x)} ${n(y - s)}l${n(s)} ${n(s)}l${n(-s)} ${n(s)}l${n(-s)} ${n(-s)}Z`;
const sparkle = (x: number, y: number, s: number) =>
  `M${n(x)} ${n(y - s)}L${n(x + s * 0.2)} ${n(y - s * 0.2)}L${n(x + s)} ${n(y)}L${n(x + s * 0.2)} ${n(y + s * 0.2)}L${n(x)} ${n(y + s)}L${n(x - s * 0.2)} ${n(y + s * 0.2)}L${n(x - s)} ${n(y)}L${n(x - s * 0.2)} ${n(y - s * 0.2)}Z`;
const bird = (x: number, y: number, s: number, flap: number) =>
  `M${n(x - 9 * s)} ${n(y - 3 * s * flap)}Q${n(x - 4 * s)} ${n(y - 5 * s * flap)} ${n(x)} ${n(y)}Q${n(x + 4 * s)} ${n(y - 5 * s * flap)} ${n(x + 9 * s)} ${n(y - 3 * s * flap)}`;

interface Tower {
  x: number;
  w: number;
  h: number;
  top: number;
}
/** A row of towers; `profile` scales their heights along x. */
function towers(
  seed: number,
  min: number,
  max: number,
  wMin: number,
  wMax: number,
  profile: Line,
) {
  const r = rng(seed);
  const list: Tower[] = [];
  for (let x = X0; x < X1; ) {
    const w = wMin + r() * (wMax - wMin),
      h = (min + r() ** 1.6 * (max - min)) * profile(x + w / 2),
      top = r();
    if (h > 14) list.push({ x, w, h, top });
    x += w + r() * 4;
  }
  return list;
}
/** Tower bodies with spires, crowns and slanted roofs, as one path. */
function bodies(list: Tower[], base: number) {
  let d = "";
  for (const { x, w, h, top } of list) {
    const y = base - h;
    d += `M${n(x)} ${base}V${n(y)}H${n(x + w)}V${base}Z`;
    if (top > 0.9)
      d += `M${n(x + w / 2 - 1.5)} ${n(y)}v-${(30 + top * 40).toFixed(0)}h3V${n(y)}Z`;
    else if (top > 0.77)
      d += `M${n(x + w * 0.18)} ${n(y)}v-16h${n(w * 0.64)}v16Z`;
    else if (top > 0.68 && h > 120)
      d += `M${n(x)} ${n(y)}L${n(x + w)} ${n(y - w * 0.3)}V${n(y)}Z`;
  }
  return d;
}
function windows(list: Tower[], base: number, lit: number, seed: number) {
  const r = rng(seed);
  let d = "";
  for (const { x, w, h } of list)
    for (let y = base - h + 10; y < base - 8; y += 15)
      for (let wx = x + 6; wx < x + w - 8; wx += 11)
        if (r() < lit) d += `M${n(wx)} ${n(y)}h5v7h-5Z`;
  return d;
}
/** The edge of each tower that faces the light. */
function rims(list: Tower[], base: number, lightX: number, width = 4) {
  let d = "";
  for (const { x, w, h } of list) {
    const left = x + w / 2 > lightX ? x : x + w - width;
    d += `M${n(left)} ${base}V${n(base - h)}h${width}V${base}Z`;
  }
  return d;
}
/** Thin horizontal strokes, thicker and longer towards the viewer. */
function strokes(
  seed: number,
  count: number,
  top: number,
  bottom: number,
  min: number,
  max: number,
  thick = 2.4,
) {
  const r = rng(seed);
  let d = "";
  for (let i = 0; i < count; i++) {
    const k = r() ** 1.4,
      y = top + k * (bottom - top),
      x = X0 + r() * SPAN,
      w = min + r() * (max - min) * (0.4 + k);
    d += `M${n(x)} ${n(y)}h${n(w)}v${n(thick * (0.6 + k))}h${n(-w)}Z`;
  }
  return d;
}

interface Glint {
  x: number;
  y: number;
  w: number;
  h: number;
  k: number;
  phase: number;
}
/** Broken bars of light on water: tight at the horizon, wide up close. */
function glitter(
  seed: number,
  cx: number,
  top: number,
  bottom: number,
  rows: number,
  w0: number,
  w1: number,
) {
  const r = rng(seed);
  const out: Glint[] = [];
  for (let i = 0; i < rows; i++) {
    const k = i / (rows - 1),
      y = top + (bottom - top) * k ** 1.5,
      w = (w0 + (w1 - w0) * k) * (0.45 + 0.55 * r()),
      h = 2 + 6 * k,
      x = cx + (r() - 0.5) * (16 + 90 * k),
      phase = r() * Math.PI * 2;
    if (w > 70 && r() < 0.45) {
      const gap = 8 + r() * 24,
        a = (w - gap) * (0.3 + r() * 0.4),
        b = w - gap - a;
      out.push({ x: x - w / 2 + a / 2, y, w: a, h, k, phase });
      out.push({ x: x + w / 2 - b / 2, y, w: b, h, k, phase: phase + 2 });
    } else out.push({ x, y, w, h, k, phase });
  }
  return out;
}

// ── Dawn: the city wakes on a lake ─────────────────────────────────────────
const H0 = 760;
const SUN0 = { x: 1000, y: 714, r: 60 };
const dawn = (() => {
  const open =
    (lo: number, hi: number, k: Line): Line =>
    (x) =>
      x > lo && x < hi ? 0 : k(x);
  const far = towers(
    21,
    26,
    150,
    24,
    58,
    open(830, 1170, (x) => 0.6 + 0.4 * bell(x, 1500, 520)),
  );
  const mid = towers(
    22,
    46,
    250,
    28,
    70,
    open(
      865,
      1135,
      (x) => 0.45 + 0.55 * bell(x, 1460, 380) + 0.3 * bell(x, 440, 300),
    ),
  );
  const near = towers(
    23,
    70,
    430,
    38,
    96,
    open(
      905,
      1095,
      (x) => 0.28 + 0.72 * bell(x, 1430, 270) + 0.42 * bell(x, 420, 250),
    ),
  );
  return {
    hills: fill(ridge(11, 744, 16, 0.2)),
    far: bodies(far, H0),
    mid: bodies(mid, H0),
    near: bodies(near, H0),
    windows: windows(near, H0, 0.06, 24),
    rims: rims(near, H0, SUN0.x),
    glints: glitter(25, SUN0.x, H0 + 5, 1078, 24, 60, 230),
    gaps: strokes(26, 90, H0 + 3, 1080, 40, 420, 4),
    shimmer: strokes(27, 26, H0 + 40, 1080, 30, 170),
    stars: (() => {
      const r = rng(28);
      let d = "";
      for (let i = 0; i < 28; i++)
        d += star(X0 + r() * SPAN, r() ** 1.6 * 260, 0.7 + r() * 1.1);
      return d;
    })(),
    streaks: [
      [-120, 430, 620, 18],
      [60, 466, 380, 10],
      [1250, 392, 640, 20],
      [1430, 430, 420, 12],
      [640, 318, 330, 9],
      [1600, 268, 300, 8],
    ],
  };
})();

// ── Valley: setting out along the ridge ────────────────────────────────────
const SUN1 = { x: 1500, y: 230 };
/** The walkable crest in the "沿着山脊出发" shot, in artwork units. */
export const trail = (x: number) =>
  872 + 22 * Math.sin(x * 0.0021 + 0.8) + 9 * Math.sin(x * 0.0063 + 2.1);
const ranges = [
  ridge(41, 600, 100, 0.62, [
    [640, 250, 190],
    [1560, 320, 60],
  ]),
  ridge(42, 652, 98, 0.55),
  ridge(43, 736, 78, 0.5),
  ridge(44, 810, 58, 0.45),
];
const valleyTones = [
  ["#97b4d2", "#d3e1eb", 430, 690],
  ["#7fa8c3", "#c7d9e4", 560, 760],
  ["#5f938a", "#a7c5bd", 660, 860],
  ["#457f5f", "#8cb69b", 750, 900],
] as const;
const valley = (() => {
  const r = rng(48);
  let pines = "";
  for (const [from, to] of [
    [-340, 230],
    [1580, 2300],
  ])
    for (let x = from; x < to; x += 30 + r() * 46)
      pines += pine(x, trail(x) + 60 + r() * 120, 160 + r() * 190);
  // Grass tufts and flowers on the meadow, larger towards the viewer.
  const g = rng(49);
  let tufts = "",
    flowers = "";
  for (let i = 0; i < 70; i++) {
    const x = X0 + g() * SPAN,
      y = trail(x) + 26 + g() ** 0.8 * 190,
      k = 0.6 + (y - 880) / 220;
    tufts += `M${n(x - 4 * k)} ${n(y)}L${n(x - 10 * k)} ${n(y - 17 * k)}L${n(x - 1 * k)} ${n(y)}ZM${n(x - 2 * k)} ${n(y)}L${n(x + 1 * k)} ${n(y - 27 * k)}L${n(x + 3 * k)} ${n(y)}ZM${n(x + 1 * k)} ${n(y)}L${n(x + 11 * k)} ${n(y - 16 * k)}L${n(x + 5 * k)} ${n(y)}Z`;
  }
  for (let i = 0; i < 90; i++) {
    const x = X0 + g() * SPAN,
      y = trail(x) + 18 + g() ** 0.9 * 200;
    flowers += star(x, y, 1.6 + (y - 880) / 90);
  }
  const ray = (deg: number, w: number) => {
    const p = (d: number) =>
      `${n(SUN1.x + 2400 * Math.cos((d * Math.PI) / 180))} ${n(SUN1.y + 2400 * Math.sin((d * Math.PI) / 180))}`;
    return `M${SUN1.x} ${SUN1.y}L${p(deg - w)}L${p(deg + w)}Z`;
  };
  return {
    layers: ranges.map((y) => fill(y)),
    snow: snow(ranges[0], 524),
    forestFar: forest(45, ranges[2], 12, 24),
    forestNear: forest(46, ranges[3], 18, 40),
    near: fill(trail),
    path: crest((x) => trail(x) + 5, 24),
    pines,
    tufts,
    flowers,
    rays: [
      [112, 1.4],
      [127, 2.6],
      [141, 1.6],
      [156, 2.8],
      [170, 1.5],
    ]
      .map(([d, w]) => ray(d, w))
      .join(""),
    clouds: [
      [200, 250, 1.15, 7],
      [860, 168, 0.8, 5],
      [1180, 360, 1, 9],
      [1760, 424, 0.65, 6],
    ],
  };
})();

// ── Dusk: evening settles on the river ─────────────────────────────────────
const H2 = 756,
  DECK = 772;
const SUN2 = { x: 960, y: 724, r: 96 };
const cableY = (x: number) => {
  const s = (x - 520) / 860;
  return 560 + 4 * s * (1 - s) * 175;
};
const LAMPS = [260, 980, 1700];
const dusk = (() => {
  const far = towers(51, 70, 320, 30, 66, (x) =>
    x > 850 && x < 1070
      ? 0.2
      : 0.5 + 0.5 * bell(x, 1450, 420) + 0.3 * bell(x, 380, 300),
  );
  const near = towers(52, 46, 250, 26, 62, (x) =>
    x > 880 && x < 1040
      ? 0.12
      : 0.55 + 0.45 * bell(x, 1520, 300) + 0.4 * bell(x, 330, 260),
  );
  const r = rng(54);
  let streaks = "";
  for (let i = 0; i < 90; i++) {
    const tw = near[Math.floor(r() * near.length)];
    const x = tw.x + 4 + r() * Math.max(1, tw.w - 8),
      end = H2 + 14 + r() ** 1.8 * 120;
    for (let y = H2 + 3; y < end; ) {
      const piece = 3 + r() * 9;
      streaks += `M${n(x + (r() - 0.5) * 4)} ${n(y)}h2.6v${n(piece)}h-2.6Z`;
      y += piece + 2 + r() * 6;
    }
  }
  let hangers = "";
  for (let x = 540; x < 1380; x += 34)
    hangers += `M${x} ${n(cableY(x))}V${DECK}`;
  let rail = `M${X0} 944H${X1}v5H${X0}ZM${X0} 966H${X1}v3H${X0}Z`;
  for (let x = X0; x < X1; x += 34) rail += `M${x} 949h3v41h-3Z`;
  const s = rng(61);
  let stars = "";
  for (let i = 0; i < 46; i++)
    stars += star(X0 + s() * SPAN, s() ** 1.5 * 300, 0.7 + s() * 1.3);
  return {
    hills: fill(ridge(55, 710, 22, 0.3)),
    far: bodies(far, H2),
    farWindows: windows(far, H2, 0.035, 56),
    near: bodies(near, H2),
    nearWindows: windows(near, H2, 0.2, 57),
    streaks,
    gaps: strokes(58, 90, H2 + 3, 1000, 40, 420, 4),
    glints: glitter(59, SUN2.x, DECK + 10, 990, 22, 90, 300),
    ripples: strokes(60, 30, 800, 990, 30, 150),
    hangers,
    rail,
    stars,
    clouds: [
      [-60, 470, 560, 18],
      [90, 505, 380, 11],
      [1240, 420, 640, 20],
      [1420, 458, 420, 12],
      [600, 362, 340, 10],
      [1680, 330, 300, 9],
    ],
  };
})();

// ── Night: the road out, under the stars ───────────────────────────────────
const MOON = { x: 1480, y: 230 };
/** The Milky Way's axis, and soft glows strung unevenly along it. */
const BAND = {
  x: 640,
  y: 330,
  angle: -42,
  clouds: [
    [-900, 20, 300, 110],
    [-560, -30, 360, 130],
    [-200, 25, 320, 100],
    [150, -20, 380, 140],
    [520, 30, 300, 110],
    [860, -10, 260, 90],
  ],
};
const TOWN = 1050;
const hills3 = {
  far: ridge(64, 790, 40, 0.65, [
    [470, 360, 250],
    [1650, 330, 210],
  ]),
  mid: ridge(66, 852, 18, 0.4, [
    [180, 300, 90],
    [1820, 300, 80],
  ]),
  near: ridge(65, 970, 18, 0.4, [
    [150, 280, 130],
    [1850, 260, 140],
  ]),
};
const night = (() => {
  const stars = [0, 1, 2].map((group) => {
    const r = rng(70 + group);
    let d = "";
    for (let i = 0; i < 80; i++)
      d += star(
        X0 + r() * SPAN,
        r() ** 1.3 * 760,
        0.8 + r() * (group === 2 ? 2 : 1.2),
      );
    return d;
  });
  // The Milky Way: a diagonal drift of faint stars, densest along its spine.
  const r = rng(73),
    a = (BAND.angle * Math.PI) / 180;
  let band = "";
  for (let i = 0; i < 380; i++) {
    const u = (r() * 2 - 1) * 1250,
      v = ((r() + r() + r()) / 3 - 0.5) * 380;
    band += star(
      BAND.x + u * Math.cos(a) - v * Math.sin(a),
      BAND.y + u * Math.sin(a) + v * Math.cos(a),
      0.5 + r() * 1.1,
    );
  }
  const glints = [
    [300, 140, 9],
    [760, 70, 7],
    [1130, 300, 8],
    [1760, 120, 10],
    [1900, 420, 7],
    [180, 470, 6],
  ]
    .map(([x, y, s]) => sparkle(x, y, s))
    .join("");
  // The road winds from the bottom of frame over the meadow to the town.
  const ex = TOWN,
    ey = hills3.mid(ex) + 1,
    rise = 1200 - ey;
  const segments = [
    [
      [1000, 1200],
      [990, 1200 - rise * 0.3],
      [850, ey + rise * 0.6],
      [860, ey + rise * 0.37],
    ],
    [
      [860, ey + rise * 0.37],
      [870, ey + rise * 0.17],
      [1110, ey + rise * 0.13],
      [1090, ey + rise * 0.05],
    ],
    [
      [1090, ey + rise * 0.05],
      [1078, ey + 6],
      [1046, ey + 3],
      [ex, ey],
    ],
  ];
  const pts: { x: number; y: number }[] = [];
  for (const [p0, p1, p2, p3] of segments)
    for (let i = pts.length ? 1 : 0; i <= 60; i++) {
      const s = i / 60,
        m = 1 - s,
        at = (k: 0 | 1) =>
          m * m * m * p0[k] +
          3 * m * m * s * p1[k] +
          3 * m * s * s * p2[k] +
          s * s * s * p3[k];
      pts.push({ x: at(0), y: at(1) });
    }
  const width = (y: number) => 2 + (y - ey) * 0.95;
  const normal = (i: number) => {
    const p = pts[Math.min(i + 1, pts.length - 1)],
      q = pts[Math.max(i - 1, 0)],
      l = Math.hypot(p.x - q.x, p.y - q.y) || 1;
    return { x: -(p.y - q.y) / l, y: (p.x - q.x) / l };
  };
  const along = [0];
  for (let i = 1; i < pts.length; i++)
    along.push(
      along[i - 1] +
        Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y),
    );
  // The road is a union of discs along its centre line, so the inside of a
  // bend can never fold back over itself; a slightly wider union is its kerb.
  const disc = (x: number, y: number, r: number) =>
    `M${n(x - r)} ${n(y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
  const total = along[along.length - 1];
  /** Position, normal and road width at a distance along the centre line. */
  const sample = (d: number) => {
    let i = 1;
    while (i < along.length - 1 && along[i] < d) i++;
    const k = (d - along[i - 1]) / (along[i] - along[i - 1] || 1),
      x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k,
      y = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k;
    return { x, y, o: normal(i), w: width(y) };
  };
  let road = "",
    kerb = "";
  for (let d = 0; d <= total; d += 2) {
    const { x, y, w } = sample(d);
    road += disc(x, y, w / 2);
    kerb += disc(x, y, w / 2 + 2);
  }
  // Centre dashes shrink with distance, as they would in perspective.
  let dashes = "";
  for (let d = 0; d < total; ) {
    const a = sample(d),
      len = Math.max(2, a.w * 0.16),
      b = sample(Math.min(total, d + len)),
      th = Math.max(0.5, a.w * 0.018);
    dashes += `M${n(a.x + a.o.x * th)} ${n(a.y + a.o.y * th)}L${n(b.x + b.o.x * th)} ${n(b.y + b.o.y * th)}L${n(b.x - b.o.x * th)} ${n(b.y - b.o.y * th)}L${n(a.x - a.o.x * th)} ${n(a.y - a.o.y * th)}Z`;
    d += len + Math.max(3, a.w * 0.2);
  }
  const t = rng(74);
  let town = "";
  for (let i = 0; i < 34; i++) {
    const x = ex + (t() + t() - 1) * 150;
    town += star(x, hills3.mid(x) - 2 - t() * 10, 1 + t() * 1.6);
  }
  const p = rng(75);
  let pines = "";
  for (const [from, to] of [
    [-320, 600],
    [1440, 2300],
  ])
    for (let x = from; x < to; x += 34 + p() * 50)
      pines += pine(x, hills3.near(x) + 60 + p() * 150, 170 + p() * 210);
  return {
    stars,
    band,
    glints,
    far: fill(hills3.far),
    farRim: crest(hills3.far),
    mid: fill(hills3.mid),
    midTrees: forest(77, hills3.mid, 9, 20),
    near: fill(hills3.near),
    ridgeTrees: forest(76, hills3.near, 18, 44),
    road,
    kerb,
    dashes,
    roadEnd: ey,
    sample,
    total,
    town,
    pines,
  };
})();

/** A hiker with a pack, walking; `step` swings the legs. */
function Hiker({ x, y, step }: { x: number; y: number; step: number }) {
  return (
    <g
      transform={`translate(${x} ${y})`}
      fill="#14251d"
      stroke="#14251d"
      strokeLinecap="round"
    >
      <path
        d={`M-6 -64L${-6 + step * 22} 0M6 -64L${6 - step * 22} 0`}
        strokeWidth="13"
        fill="none"
      />
      <rect x="-15" y="-126" width="30" height="66" rx="13" stroke="none" />
      <rect x="-31" y="-122" width="22" height="46" rx="8" stroke="none" />
      <circle cx="3" cy="-140" r="15" stroke="none" />
      <path d={`M12 -110L${26 + step * 10} -72`} strokeWidth="9" fill="none" />
      <path
        d={`M${26 + step * 10} -72L${34 + step * 16} 0`}
        strokeWidth="4"
        fill="none"
      />
    </g>
  );
}

function Sailboat({
  x,
  y,
  s,
  color,
}: {
  x: number;
  y: number;
  s: number;
  color: string;
}) {
  return (
    <g transform={`translate(${n(x)} ${n(y)}) scale(${s})`} fill={color}>
      <path d="M-42 -4H42L31 9H-31Z" />
      <path d="M-1.5 -4V-96h3V-4Z" />
      <path d="M5 -92L38 -12H5Z" />
      <path d="M-5 -80L-36 -12H-5Z" />
    </g>
  );
}

/** A flat cumulus with a shaded underside; (x, y) is the middle of its base. */
function Cloud({ x, y, s }: { x: number; y: number; s: number }) {
  const puffs = (
    <>
      <circle cx="-70" cy="-22" r="22" />
      <circle cx="-30" cy="-40" r="40" />
      <circle cx="28" cy="-54" r="54" />
      <circle cx="84" cy="-30" r="30" />
      <circle cx="116" cy="-15" r="15" />
      <rect x="-92" y="-30" width="223" height="30" rx="15" />
    </>
  );
  return (
    <g transform={`translate(${n(x)} ${y}) scale(${s})`}>
      <g fill="#d3e5f2">{puffs}</g>
      <g fill="#ffffff" transform="translate(4 -12) scale(.97)">
        {puffs}
      </g>
    </g>
  );
}

/** Long thin clouds lit from below by a low sun, thinning out at both ends. */
function Streaks({
  id,
  items,
  t,
  color,
  light,
}: {
  id: string;
  items: number[][];
  t: number;
  color: [string, number];
  light: [string, number];
}) {
  const fade = (name: string, [c, a]: [string, number]) => (
    <linearGradient id={`${id}${name}`}>
      <stop stopColor={c} stopOpacity="0" />
      <stop offset=".25" stopColor={c} stopOpacity={a} />
      <stop offset=".7" stopColor={c} stopOpacity={a} />
      <stop offset="1" stopColor={c} stopOpacity="0" />
    </linearGradient>
  );
  return (
    <>
      <defs>
        {fade("streak", color)}
        {fade("streakLit", light)}
      </defs>
      {items.map(([x, y, w, h], i) => (
        <g key={i} transform={`translate(${n(t * (2.5 + (i % 3) * 1.5))} 0)`}>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={h / 2}
            fill={`url(#${id}streak)`}
          />
          <rect
            x={x + w * 0.14}
            y={y + h * 0.5}
            width={w * 0.66}
            height={h * 0.5}
            rx={h * 0.25}
            fill={`url(#${id}streakLit)`}
          />
        </g>
      ))}
    </>
  );
}

function Birds({
  t,
  x,
  y,
  color,
  count = 4,
  scale = 1,
}: {
  t: number;
  x: number;
  y: number;
  color: string;
  count?: number;
  scale?: number;
}) {
  return (
    <g
      fill="none"
      stroke={color}
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {Array.from({ length: count }, (_, i) => (
        <path
          key={i}
          d={bird(
            x + i * 46 * scale + ((i * 37) % 23) + t * 18,
            y + ((i * 53) % 41) + Math.sin(t * 1.8 + i) * 5,
            scale * (1.2 - i * 0.12),
            Math.sin(t * 8 + i * 1.9),
          )}
        />
      ))}
    </g>
  );
}

function Glitter({
  bars,
  t,
  color,
}: {
  bars: Glint[];
  t: number;
  color: string;
}) {
  return (
    <g fill={color}>
      {bars.map((b, i) => {
        const w = b.w * (0.82 + 0.18 * Math.sin(t * 2.1 + b.phase));
        return (
          <rect
            key={i}
            x={n(b.x - w / 2 + Math.sin(t * 1.4 + b.phase) * (3 + 9 * b.k))}
            y={n(b.y)}
            width={n(w)}
            height={n(b.h)}
            rx={n(b.h / 2)}
            opacity={(1 - 0.72 * b.k).toFixed(2)}
          />
        );
      })}
    </g>
  );
}

/** Mirrors `children` about the waterline `y`, fading with depth and broken by ripples. */
function Reflection({
  id,
  y,
  depth,
  gaps,
  sway,
  opacity,
  children,
}: {
  id: string;
  y: number;
  depth: number;
  gaps: string;
  sway: number;
  opacity: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <defs>
        <linearGradient
          id={`${id}fade`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1={y}
          x2="0"
          y2={y + depth}
        >
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </linearGradient>
        <mask
          id={`${id}ripple`}
          maskUnits="userSpaceOnUse"
          x={X0}
          y={y}
          width={SPAN}
          height={depth}
        >
          <rect
            x={X0}
            y={y}
            width={SPAN}
            height={depth}
            fill={`url(#${id}fade)`}
          />
          <path d={gaps} fill="#000" transform={`translate(${n(sway)} 0)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}ripple)`} opacity={opacity}>
        <g transform={`translate(0 ${2 * y}) scale(1 -1)`}>{children}</g>
      </g>
    </>
  );
}

interface ShotProps {
  variant: number;
  drift?: number;
  aspect?: number;
  focus?: number;
  /** Where a hiker stands in the ridge shot, if anywhere. */
  walker?: number;
  lite?: boolean;
  style?: React.CSSProperties;
}

/** One of the four shots, animated by the composition's frame. */
export function Landscape(props: ShotProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return <Shot id={id} t={useCurrentFrame() / FPS} {...props} />;
}

/**
 * One of the four shots at `t` seconds. `aspect` crops it like a reframed
 * timeline and `focus` picks the crop's x; `lite` drops fine detail for small
 * thumbnails. `file` gives it a fixed size for saving as a standalone SVG.
 */
export function Shot({
  id,
  t,
  variant,
  drift = 0,
  aspect = 16 / 9,
  focus = 0.5,
  walker,
  lite = false,
  style,
  file = false,
}: ShotProps & { id: string; t: number; file?: boolean }) {
  let vw = 1920,
    vh = 1080;
  if (aspect < 1920 / 1080) vw = 1080 * aspect;
  else vh = 1920 / aspect;
  const vx = (1920 - vw) * focus,
    vy = (1080 - vh) / 2;
  const at = (depth: number) => `translate(${(drift * depth).toFixed(2)} 0)`;
  // Ground receding from depth d1 at y1 to d0 at y0: a shear, so nearer
  // ground slides further than the horizon.
  const slope = (y0: number, d0: number, y1: number, d1: number) => {
    const k = (d1 - d0) / (y1 - y0);
    return `matrix(1 0 ${(drift * k).toFixed(5)} 1 ${(drift * (d0 - y0 * k)).toFixed(2)} 0)`;
  };
  const u = (name: string) => `url(#${id}${name})`;
  const scene = [dawnScene, valleyScene, duskScene, nightScene][variant % 4];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      {...(file
        ? { width: vw, height: vh }
        : {
            preserveAspectRatio: "xMidYMid slice",
            style: {
              width: "100%",
              height: "100%",
              display: "block",
              ...style,
            },
          })}
    >
      {scene({ id, u, at, slope, t, lite, walker })}
    </svg>
  );
}

interface Paint {
  id: string;
  u: (name: string) => string;
  at: (depth: number) => string;
  slope: (y0: number, d0: number, y1: number, d1: number) => string;
  t: number;
  lite: boolean;
  walker?: number;
}
const vgrad = (
  id: string,
  name: string,
  y1: number,
  y2: number,
  stops: [number, string, number?][],
) => (
  <linearGradient
    id={`${id}${name}`}
    gradientUnits="userSpaceOnUse"
    x1="0"
    y1={y1}
    x2="0"
    y2={y2}
  >
    {stops.map(([o, c, a = 1], i) => (
      <stop key={i} offset={o} stopColor={c} stopOpacity={a} />
    ))}
  </linearGradient>
);
const glow = (id: string, name: string, color: string, strength: number) => (
  <radialGradient id={`${id}${name}`}>
    <stop stopColor={color} stopOpacity={strength} />
    <stop offset=".3" stopColor={color} stopOpacity={strength * 0.5} />
    <stop offset="1" stopColor={color} stopOpacity="0" />
  </radialGradient>
);
const vignette = (id: string, color: string, strength: number) => (
  <radialGradient
    id={`${id}vignette`}
    gradientUnits="userSpaceOnUse"
    cx="960"
    cy="560"
    r="1180"
  >
    <stop offset=".55" stopColor={color} stopOpacity="0" />
    <stop offset="1" stopColor={color} stopOpacity={strength} />
  </radialGradient>
);
const cover = (paint: string) => (
  <rect x={X0} y="-200" width={SPAN} height="1500" fill={paint} />
);

function dawnScene({ id, u, at, t, lite }: Paint) {
  const sway = Math.sin(t * 0.7) * 16;
  const { x: sx, y: sy, r: sr } = SUN0;
  return (
    <>
      <defs>
        {vgrad(id, "sky", 0, 1080, [
          [0, "#2f3d7c"],
          [0.3, "#6467ad"],
          [0.47, "#b88dc4"],
          [0.59, "#f1a4b5"],
          [0.665, "#ffc8a2"],
          [0.705, "#ffe9c4"],
        ])}
        {glow(id, "sun", "#fff0cf", 1)}
        {glow(id, "wash", "#ffe4c6", 0.5)}
        {vgrad(id, "hills", 700, H0, [
          [0, "#e7b2c6"],
          [1, "#f6cbc6"],
        ])}
        {vgrad(id, "near", 330, H0, [
          [0, "#665d9f"],
          [1, "#46407e"],
        ])}
        {vgrad(id, "haze", 600, H0, [
          [0, "#ffd9c2", 0],
          [1, "#ffd9c2", 0.55],
        ])}
        {vgrad(id, "water", H0, 1080, [
          [0, "#ffdcbc"],
          [0.16, "#f6b2b2"],
          [0.5, "#a386c1"],
          [1, "#43458a"],
        ])}
        <radialGradient
          id={`${id}rim`}
          gradientUnits="userSpaceOnUse"
          cx={sx}
          cy={sy}
          r="1100"
        >
          <stop stopColor="#ffdcb4" />
          <stop offset=".45" stopColor="#ffc9a8" stopOpacity=".55" />
          <stop offset="1" stopColor="#f4abc0" stopOpacity=".08" />
        </radialGradient>
        {vignette(id, "#1b1442", 0.26)}
      </defs>
      {cover(u("sky"))}
      <circle cx={sx} cy={sy} r="660" fill={u("sun")} transform={at(0.25)} />
      {!lite && <path d={dawn.stars} fill="#fff6ee" opacity=".45" />}
      <Streaks
        id={id}
        items={dawn.streaks}
        t={t}
        color={["#e2a2c6", 0.7]}
        light={["#ffd8bf", 0.85]}
      />
      {!lite && <Birds t={t} x={330} y={250} color="#4a3d70" />}
      <circle cx={sx} cy={sy} r={sr} fill="#fff8e6" transform={at(0.25)} />
      <g transform={at(0.15)}>
        <path d={dawn.hills} fill={u("hills")} />
      </g>
      <g transform={at(0.3)}>
        <path d={dawn.far} fill="#d9a7c8" />
      </g>
      <g transform={at(0.45)}>
        <path d={dawn.mid} fill="#a98ac2" />
      </g>
      <rect x={X0} y="600" width={SPAN} height={H0 - 600} fill={u("haze")} />
      <circle cx={sx} cy={sy} r="540" fill={u("wash")} transform={at(0.25)} />
      <g transform={at(0.65)}>
        <path d={dawn.near} fill={u("near")} />
        <path d={dawn.rims} fill={u("rim")} />
        {!lite && <path d={dawn.windows} fill="#ffe2a6" opacity=".8" />}
      </g>
      <rect x={X0} y={H0} width={SPAN} height={1200 - H0} fill={u("water")} />
      <Reflection
        id={id}
        y={H0}
        depth={270}
        gaps={lite ? "" : dawn.gaps}
        sway={sway}
        opacity={0.5}
      >
        <g transform={at(0.45)}>
          <path d={dawn.mid} fill="#a487bf" stroke="#a487bf" strokeWidth="6" />
        </g>
        <g transform={at(0.65)}>
          <path d={dawn.near} fill="#4b4585" stroke="#4b4585" strokeWidth="6" />
        </g>
      </Reflection>
      <g transform={at(0.65)}>
        <path
          d={`M${X0} ${H0 - 3}H905V${H0 + 4}H${X0}ZM1095 ${H0 - 3}H${X1}V${H0 + 4}H1095Z`}
          fill="#3d3772"
        />
      </g>
      <g transform={at(0.25)}>
        <Glitter
          bars={lite ? dawn.glints.filter((_, i) => i % 2 === 0) : dawn.glints}
          t={t}
          color="#fff3d8"
        />
      </g>
      {!lite && (
        <>
          <path
            d={dawn.shimmer}
            fill="#ffffff"
            opacity=".18"
            transform={`translate(${n(sway)} 0)`}
          />
          <g transform={at(0.8)}>
            <Sailboat x={520 + t * 5} y={880} s={0.7} color="#3a3570" />
            <g transform="translate(0 1767) scale(1 -1)" opacity=".22">
              <Sailboat x={520 + t * 5} y={880} s={0.7} color="#3a3570" />
            </g>
          </g>
        </>
      )}
      {cover(u("vignette"))}
    </>
  );
}

function valleyScene({ id, u, at, t, lite, walker }: Paint) {
  const { x: sx, y: sy } = SUN1;
  return (
    <>
      <defs>
        {vgrad(id, "sky", 0, 1080, [
          [0, "#3c89d4"],
          [0.34, "#76b6e6"],
          [0.54, "#b6dbf0"],
          [0.64, "#e6eedf"],
          [0.72, "#f6edd6"],
        ])}
        {glow(id, "sun", "#fff8df", 0.95)}
        <radialGradient
          id={`${id}ray`}
          gradientUnits="userSpaceOnUse"
          cx={sx}
          cy={sy}
          r="1300"
        >
          <stop stopColor="#fffbe6" stopOpacity=".16" />
          <stop offset="1" stopColor="#fffbe6" stopOpacity="0" />
        </radialGradient>
        {valleyTones.map(([top, mist, y1, y2], i) => (
          <React.Fragment key={i}>
            {vgrad(id, `l${i}`, y1, y2, [
              [0, top],
              [1, mist],
            ])}
          </React.Fragment>
        ))}
        {vgrad(id, "near", 830, 1080, [
          [0, "#4d8a58"],
          [1, "#22503a"],
        ])}
        {vignette(id, "#0e2a3c", 0.2)}
      </defs>
      {cover(u("sky"))}
      <circle cx={sx} cy={sy} r="440" fill={u("sun")} />
      {!lite && (
        <path
          d={valley.rays}
          fill={u("ray")}
          transform={`rotate(${n(Math.sin(t * 0.4) * 1.5)} ${sx} ${sy})`}
        />
      )}
      <circle cx={sx} cy={sy} r="46" fill="#fffdf3" />
      {valley.clouds.map(([x, y, s, v], i) => (
        <Cloud key={i} x={((x + t * v + 300) % 2700) - 300} y={y} s={s} />
      ))}
      {!lite && (
        <Birds t={t} x={560} y={300} color="#3d5d7c" count={3} scale={0.8} />
      )}
      {valley.layers.map((d, i) => (
        <g key={i} transform={at(0.12 + i * 0.16)}>
          <path d={d} fill={u(`l${i}`)} />
          {i === 0 && <path d={valley.snow} fill="#f5f9fc" />}
          {i === 2 && !lite && <path d={valley.forestFar} fill="#56877f" />}
          {i === 3 && <path d={valley.forestNear} fill="#3b7052" />}
        </g>
      ))}
      <g transform={at(1)}>
        <path d={valley.near} fill={u("near")} />
        <path
          d={valley.path}
          fill="none"
          stroke="#efe2b8"
          strokeWidth="5"
          strokeLinecap="round"
          opacity=".7"
        />
        {!lite && (
          <>
            <path d={valley.tufts} fill="#2c6340" opacity=".85" />
            <path d={valley.flowers} fill="#fbe9a6" opacity=".9" />
          </>
        )}
        <path d={valley.pines} fill="#16352a" />
        {walker !== undefined && (
          <Hiker
            x={walker}
            y={trail(walker) + 2}
            step={Math.sin(walker / 24)}
          />
        )}
      </g>
      {cover(u("vignette"))}
    </>
  );
}

function duskScene({ id, u, at, t, lite }: Paint) {
  const sway = Math.sin(t * 0.8) * 12;
  const { x: sx, y: sy, r: sr } = SUN2;
  return (
    <>
      <defs>
        {vgrad(id, "sky", 0, 1080, [
          [0, "#1c2457"],
          [0.28, "#4a3a86"],
          [0.47, "#a6517f"],
          [0.59, "#e97c63"],
          [0.67, "#ffb176"],
          [0.7, "#ffd08f"],
        ])}
        {glow(id, "sun", "#ffd39a", 1)}
        {glow(id, "lamp", "#ffd9a0", 0.85)}
        {vgrad(id, "hills", 660, 780, [
          [0, "#a3588b"],
          [1, "#8b4c86"],
        ])}
        {vgrad(id, "near", 500, H2, [
          [0, "#3b2b60"],
          [1, "#2a1f4b"],
        ])}
        {vgrad(id, "haze", 620, H2, [
          [0, "#ff9f7a", 0],
          [1, "#ff9f7a", 0.4],
        ])}
        {vgrad(id, "water", H2, 1080, [
          [0, "#f7a66d"],
          [0.2, "#d4737a"],
          [0.55, "#5b3b70"],
          [1, "#221d45"],
        ])}
        {vgrad(id, "pier", DECK, 960, [
          [0, "#22183c", 0.5],
          [1, "#22183c", 0],
        ])}
        {vignette(id, "#0f0a24", 0.3)}
      </defs>
      {cover(u("sky"))}
      {!lite && (
        <path
          d={dusk.stars}
          fill="#fff4e6"
          opacity={(0.6 + 0.3 * Math.sin(t * 1.7)).toFixed(2)}
        />
      )}
      <circle cx={sx} cy={sy} r="680" fill={u("sun")} />
      <circle cx={sx} cy={sy} r={sr} fill="#ffe6bd" />
      <Streaks
        id={id}
        items={dusk.clouds}
        t={t}
        color={["#8c4a86", 0.75]}
        light={["#ff9f7c", 0.8]}
      />
      {!lite && (
        <Birds t={t} x={1280} y={330} color="#2a1d45" count={3} scale={0.85} />
      )}
      <g transform={at(0.2)}>
        <path d={dusk.hills} fill={u("hills")} />
      </g>
      <g transform={at(0.35)}>
        <path d={dusk.far} fill="#6c3e7f" />
        {!lite && <path d={dusk.farWindows} fill="#ffb87a" opacity=".55" />}
      </g>
      <rect x={X0} y="620" width={SPAN} height={H2 - 620} fill={u("haze")} />
      <g transform={at(0.5)}>
        <path d={dusk.near} fill={u("near")} />
        {!lite && <path d={dusk.nearWindows} fill="#ffcf7a" opacity=".9" />}
      </g>
      <rect x={X0} y={H2} width={SPAN} height={1200 - H2} fill={u("water")} />
      <Reflection
        id={id}
        y={H2}
        depth={240}
        gaps={lite ? "" : dusk.gaps}
        sway={sway}
        opacity={0.55}
      >
        <g transform={at(0.5)}>
          <path d={dusk.near} fill="#2a1f4b" />
        </g>
      </Reflection>
      {!lite && (
        <g transform={at(0.5)}>
          <path
            d={dusk.streaks}
            fill="#ffcf7a"
            opacity=".42"
            transform={`translate(${n(sway * 0.25)} 0)`}
          />
        </g>
      )}
      <Glitter bars={dusk.glints} t={t} color="#ffe2b0" />
      {!lite && (
        <path
          d={dusk.ripples}
          fill="#ffe0b0"
          opacity=".22"
          transform={`translate(${n(sway)} 0)`}
        />
      )}
      <g transform={at(0.8)}>
        <rect x="508" y={DECK + 8} width="24" height="170" fill={u("pier")} />
        <rect x="1368" y={DECK + 8} width="24" height="170" fill={u("pier")} />
        <g stroke="#22183c" fill="none">
          <path
            d={`M${X0} 760Q160 650 520 560M1380 560Q1760 650 ${X1} 760M520 560Q950 910 1380 560`}
            strokeWidth="5"
          />
          <path d={dusk.hangers} strokeWidth="2" opacity=".8" />
        </g>
        <rect x="508" y="536" width="24" height={DECK - 536} fill="#22183c" />
        <rect x="1368" y="536" width="24" height={DECK - 536} fill="#22183c" />
        <rect x={X0} y={DECK - 6} width={SPAN} height="14" fill="#22183c" />
        {!lite && (
          <g fill="#ffd27a">
            {Array.from({ length: 44 }, (_, i) => (
              <circle
                key={i}
                cx={X0 + i * 62}
                cy={DECK - 9}
                r="3"
                opacity={(0.6 + 0.4 * Math.sin(t * 3 + i)).toFixed(2)}
              />
            ))}
            {Array.from({ length: 19 }, (_, i) => {
              const x = 563 + i * 43;
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={n(cableY(x) - 3)}
                  r="2.4"
                  opacity={(0.55 + 0.45 * Math.sin(t * 2.4 + i * 1.3)).toFixed(
                    2,
                  )}
                />
              );
            })}
          </g>
        )}
      </g>
      <g transform={at(1)}>
        {!lite &&
          LAMPS.map((x) => (
            <circle key={x} cx={x} cy="873" r="130" fill={u("lamp")} />
          ))}
        <path d={dusk.rail} fill="#1a1230" />
        <rect x={X0} y="990" width={SPAN} height="210" fill="#150f28" />
        <path d={`M${X0} 990H${X1}`} stroke="#3a2c58" strokeWidth="4" />
        {LAMPS.map((x) => (
          <g key={x} fill="#1a1230">
            <rect x={x - 3.5} y="878" width="7" height="112" />
            <path d={`M${x - 13} 866h26l-4 -10h-18z`} />
            <circle cx={x} cy="873" r="8" fill="#ffe6b5" />
          </g>
        ))}
      </g>
      {cover(u("vignette"))}
    </>
  );
}

function nightScene({ id, u, at, slope, t, lite }: Paint) {
  const meteor = ((t + 4) % 6) / 0.7;
  const car = night.sample((t * 70 + 120) % night.total);
  return (
    <>
      <defs>
        {vgrad(id, "sky", 0, 1080, [
          [0, "#050821"],
          [0.34, "#0e1645"],
          [0.56, "#232866"],
          [0.66, "#3f377a"],
          [0.72, "#5e4486"],
        ])}
        {glow(id, "moon", "#dfe6ff", 0.55)}
        {glow(id, "band", "#93a2ff", 0.22)}
        {glow(id, "core", "#e2e6ff", 0.12)}
        {glow(id, "town", "#ffb86b", 0.5)}
        {glow(id, "tail", "#ff6a48", 0.7)}
        {vgrad(id, "far", 520, 900, [
          [0, "#2b3170"],
          [1, "#1b1f50"],
        ])}
        {vgrad(id, "mid", 740, 960, [
          [0, "#1c1f52"],
          [1, "#13163d"],
        ])}
        {vgrad(id, "near", 820, 1080, [
          [0, "#10133a"],
          [1, "#080a22"],
        ])}
        {vgrad(id, "road", night.roadEnd, 1200, [
          [0, "#4a4f8a"],
          [1, "#1c1f45"],
        ])}
        <radialGradient
          id={`${id}rim`}
          gradientUnits="userSpaceOnUse"
          cx={MOON.x}
          cy={MOON.y}
          r="1100"
        >
          <stop stopColor="#c9d0ff" stopOpacity=".7" />
          <stop offset="1" stopColor="#c9d0ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}meteor`} x2="1">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}crescent`}>
          <rect x="1400" y="150" width="160" height="160" fill="#fff" />
          <circle cx="1503" cy="214" r="50" fill="#000" />
        </mask>
        {vignette(id, "#02030f", 0.35)}
      </defs>
      {cover(u("sky"))}
      {!lite && (
        <g transform={`rotate(${BAND.angle} ${BAND.x} ${BAND.y})`}>
          <ellipse
            cx={BAND.x}
            cy={BAND.y}
            rx="1250"
            ry="260"
            fill={u("band")}
          />
          {BAND.clouds.map(([du, dv, rx, ry], i) => (
            <ellipse
              key={i}
              cx={BAND.x + du}
              cy={BAND.y + dv}
              rx={rx}
              ry={ry}
              fill={u("core")}
            />
          ))}
        </g>
      )}
      {!lite && <path d={night.band} fill="#e8ebff" opacity=".7" />}
      {night.stars.map((d, i) =>
        lite && i > 0 ? null : (
          <path
            key={i}
            d={d}
            fill="#f4f1ff"
            opacity={(
              0.55 +
              0.45 * Math.sin(t * (1.3 + i * 0.6) + i * 2)
            ).toFixed(2)}
          />
        ),
      )}
      {!lite && (
        <path
          d={night.glints}
          fill="#ffffff"
          opacity={(0.75 + 0.25 * Math.sin(t * 2.2)).toFixed(2)}
        />
      )}
      {!lite && meteor < 1 && (
        <path
          d={`M${n(700 - 280 * meteor)} ${n(90 + 130 * meteor)}l${n(170 * (1 - meteor) + 30)} ${n(-80 * (1 - meteor) - 14)}`}
          stroke={u("meteor")}
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity={(1 - meteor).toFixed(2)}
        />
      )}
      <circle cx={MOON.x} cy={MOON.y} r="270" fill={u("moon")} />
      <circle
        cx={MOON.x}
        cy={MOON.y}
        r="54"
        fill="#fdf3da"
        mask={u("crescent")}
      />
      <g transform={at(0.25)}>
        <path d={night.far} fill={u("far")} />
        <path
          d={night.farRim}
          fill="none"
          stroke={u("rim")}
          strokeWidth="2.5"
        />
      </g>
      <g transform={at(0.45)}>
        {!lite && (
          <circle
            cx={TOWN}
            cy={hills3.mid(TOWN) - 10}
            r="210"
            fill={u("town")}
          />
        )}
        <path d={night.mid} fill={u("mid")} />
        {!lite && <path d={night.midTrees} fill="#1c1f52" />}
        <path
          d={night.town}
          fill="#ffd391"
          opacity={(0.85 + 0.15 * Math.sin(t * 3.1)).toFixed(2)}
        />
      </g>
      <g transform={slope(night.roadEnd, 0.45, 1200, 1)}>
        <path d={night.near} fill={u("near")} />
        {!lite && <path d={night.ridgeTrees} fill="#10133a" />}
        <path d={night.kerb} fill="#9aa2e0" opacity=".3" />
        <path d={night.road} fill={u("road")} />
        <path d={night.dashes} fill="#f2dfa4" opacity=".75" />
        {!lite && (
          <g>
            <circle
              cx={car.x}
              cy={car.y}
              r={car.w * 0.18 + 6}
              fill={u("tail")}
            />
            {[-1, 1].map((side) => (
              <circle
                key={side}
                cx={car.x + side * car.o.x * car.w * 0.07}
                cy={car.y + side * car.o.y * car.w * 0.07}
                r={Math.max(1, car.w * 0.012)}
                fill="#ff7a52"
              />
            ))}
          </g>
        )}
      </g>
      <g transform={at(1)}>
        <path d={night.pines} fill="#05071a" />
      </g>
      {cover(u("vignette"))}
    </>
  );
}
