import type {
  ClipAdvanced,
  ClipMask,
  SpeedCurve,
  TimelineProfile,
} from "./advanced-model";
import type { Project } from "./model";

export const blendModeNames = {
  normal: "正常",
  multiply: "正片叠底",
  screen: "滤色",
  overlay: "叠加",
  darken: "变暗",
  lighten: "变亮",
  "color-dodge": "颜色减淡",
  "color-burn": "颜色加深",
  "hard-light": "强光",
  "soft-light": "柔光",
  difference: "差值",
  exclusion: "排除",
  hue: "色相",
  saturation: "饱和度",
  color: "颜色",
  luminosity: "明度",
};
export const standardFrameRates = [
  { name: "23.976", numerator: 24000, denominator: 1001 },
  { name: "24", numerator: 24, denominator: 1 },
  { name: "25", numerator: 25, denominator: 1 },
  { name: "29.97", numerator: 30000, denominator: 1001 },
  { name: "30", numerator: 30, denominator: 1 },
  { name: "50", numerator: 50, denominator: 1 },
  { name: "59.94", numerator: 60000, denominator: 1001 },
  { name: "60", numerator: 60, denominator: 1 },
];
export function formatFrameTimecode(
  frame: number,
  profile: Pick<TimelineProfile, "rate" | "dropFrame">,
) {
  const nominal = Math.round(profile.rate.numerator / profile.rate.denominator);
  let value = Math.max(0, Math.floor(frame));
  if (profile.dropFrame) {
    const drop = nominal === 60 ? 4 : 2;
    const perTen = nominal * 600 - drop * 9;
    const perMinute = nominal * 60 - drop;
    const blocks = Math.floor(value / perTen),
      rest = value % perTen;
    value +=
      blocks * drop * 9 +
      drop * Math.max(0, Math.floor((rest - drop) / perMinute));
  }
  const ff = value % nominal;
  value = Math.floor(value / nominal);
  const ss = value % 60;
  value = Math.floor(value / 60);
  const mm = value % 60,
    hh = Math.floor(value / 60);
  return (
    [hh, mm, ss].map((x) => String(x).padStart(2, "0")).join(":") +
    (profile.dropFrame ? ";" : ":") +
    String(ff).padStart(2, "0")
  );
}
/** Source-position speed curves integrate ds / speed(s); no guessed frame count. */
export function remappedDuration(
  duration: number,
  points: SpeedCurve,
  until = 1,
) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      end = Math.min(until, b.position);
    if (end <= a.position) break;
    const length = b.position - a.position,
      slope = (b.speed - a.speed) / length;
    const span = end - a.position;
    total +=
      duration *
      (Math.abs(slope) < 1e-8
        ? span / a.speed
        : Math.log((a.speed + slope * span) / a.speed) / slope);
  }
  return total;
}
export function sourceAtOutput(
  seconds: number,
  duration: number,
  points: SpeedCurve,
) {
  let remaining = Math.max(0, seconds);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      span = b.position - a.position;
    const slope = (b.speed - a.speed) / span;
    const segment =
      duration *
      (Math.abs(slope) < 1e-8
        ? span / a.speed
        : Math.log(b.speed / a.speed) / slope);
    if (remaining <= segment)
      return (
        duration *
        (a.position +
          (Math.abs(slope) < 1e-8
            ? (remaining * a.speed) / duration
            : (a.speed * Math.expm1((remaining * slope) / duration)) / slope))
      );
    remaining -= segment;
  }
  return duration;
}
export function speedAt(position: number, points: SpeedCurve) {
  for (let i = 1; i < points.length; i++)
    if (position <= points[i].position) {
      const a = points[i - 1],
        b = points[i],
        f = Math.max(0, (position - a.position) / (b.position - a.position));
      return a.speed + f * (b.speed - a.speed);
    }
  return points.at(-1)!.speed;
}
export function sampleCurve(
  points: [number, number][] | undefined,
  value: number,
) {
  if (!points) return value;
  const x = Math.max(0, Math.min(1, value));
  for (let i = 1; i < points.length; i++)
    if (x <= points[i][0]) {
      const a = points[i - 1],
        b = points[i];
      return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
    }
  return points.at(-1)![1];
}
export function sampleMask(mask: ClipMask, frame: number): ClipMask {
  const keys = [...mask.keys].sort((a, b) => a.frame - b.frame);
  if (!keys.length) return mask;
  const right = keys.findIndex((k) => k.frame >= frame);
  if (right === 0) return { ...mask, ...keys[0] };
  if (right === -1) return { ...mask, ...keys.at(-1)! };
  const a = keys[right - 1],
    b = keys[right],
    f = (frame - a.frame) / (b.frame - a.frame);
  return {
    ...mask,
    ...Object.fromEntries(
      ["x", "y", "width", "height", "rotation", "feather"].map((k) => [
        k,
        a[k as "x"] + (b[k as "x"] - a[k as "x"]) * f,
      ]),
    ),
  };
}
const numeric = (n: number) => Number(n.toFixed(5));
/** Numeric geometry only. This never embeds arbitrary user SVG or markup. */
export function maskSvg(
  masks: ClipMask[],
  width: number,
  height: number,
  frame = 0,
) {
  const defs: string[] = [];
  let body = `<rect width="${width}" height="${height}" fill="${masks[0]?.operation === "add" ? "black" : "white"}"/>`;
  masks.forEach((original, index) => {
    const m = sampleMask(original, frame),
      w = m.width * width,
      h = m.height * height;
    const coordinates = (p: [number, number]) =>
      `${numeric((p[0] - 0.5) * w)},${numeric((p[1] - 0.5) * h)}`;
    let shape =
      m.shape === "ellipse"
        ? `<ellipse rx="${w / 2}" ry="${h / 2}"/>`
        : `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}"/>`;
    if (m.shape === "polygon")
      shape = `<polygon points="${(
        m.points ?? [
          [0, 1],
          [0.5, 0],
          [1, 1],
        ]
      )
        .map((p) => coordinates(p as [number, number]))
        .join(" ")}"/>`;
    if (m.shape === "bezier" && m.anchors?.length) {
      const a = m.anchors;
      let d = `M${coordinates(a[0].point)}`;
      for (let i = 0; i < a.length; i++) {
        const next = a[(i + 1) % a.length];
        d += ` C${coordinates(a[i].outgoing ?? a[i].point)} ${coordinates(next.incoming ?? next.point)} ${coordinates(next.point)}`;
      }
      shape = `<path d="${d} Z"/>`;
    }
    if (m.shape === "brush")
      shape = (m.strokes ?? [])
        .map(
          (s) =>
            `<path d="${s.points.map((p, i) => `${i ? "L" : "M"}${coordinates(p)}`).join(" ")}${s.points.length === 1 ? " l0.001,0" : ""}" stroke="${s.erase !== m.inverted ? "black" : "white"}" stroke-width="${2 * s.radius * Math.min(width, height)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
        )
        .join("");
    const fid = `blur${index}`,
      mid = `shape${index}`;
    defs.push(
      `<filter id="${fid}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${(m.feather * Math.min(width, height)) / 3}"/></filter>`,
    );
    const geometry = `<g fill="${m.inverted ? "black" : "white"}" transform="translate(${m.x * width} ${m.y * height}) rotate(${m.rotation})" filter="url(#${fid})">${shape}</g>`;
    defs.push(
      `<mask id="${mid}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" style="mask-type:luminance"><rect width="${width}" height="${height}" fill="${m.inverted ? "white" : "black"}"/>${geometry}</mask>`,
    );
    if (m.operation === "intersect") {
      const intersectId = `intersection${index}`,
        base = Math.round((1 - m.opacity) * 255);
      defs.push(
        `<mask id="${intersectId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" style="mask-type:luminance"><rect width="${width}" height="${height}" fill="rgb(${base},${base},${base})"/><rect width="${width}" height="${height}" fill="white" mask="url(#${mid})"/></mask>`,
      );
      body = `<g mask="url(#${intersectId})">${body}</g>`;
    } else
      body += `<rect width="${width}" height="${height}" fill="${m.operation === "subtract" ? "black" : "white"}" opacity="${m.opacity}" mask="url(#${mid})"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${defs.join("")}</defs>${body}</svg>`;
}
export function canvasRelations(project: Project, nodeId: string) {
  const node = project.canvas.find((n) => n.id === nodeId);
  if (!node) throw new Error("画布节点不存在");
  const usedAsset = node.referenceId;
  return {
    node,
    members: project.canvas.filter((n) => n.parentId === nodeId),
    referencedBy: project.canvas.filter((n) => n.references?.includes(nodeId)),
    references: (node.references ?? [])
      .map((id) => project.canvas.find((n) => n.id === id))
      .filter(Boolean),
    mediaHistory: node.history ?? [],
    sourceReferences: project.story.entities.filter(
      (e) => usedAsset && e.referenceAssetIds.includes(usedAsset),
    ),
    clips: project.timelines.flatMap((t) =>
      t.clips
        .filter((c) => c.assetId === usedAsset)
        .map((c) => ({ timelineId: t.id, clipId: c.id })),
    ),
    generationHistory: project.story.shots
      .filter(
        (s) =>
          s.assetId === usedAsset ||
          s.entityIds.includes(node.referenceId ?? ""),
      )
      .map((s) => ({ shotId: s.id, production: s.production })),
  };
}

export function dependencyValue(
  project: Project,
  dep: {
    kind: "clip" | "asset" | "timeline" | "timeline-content";
    id: string;
    timelineId?: string;
  },
) {
  if (dep.kind === "asset") {
    const asset = project.assets.find((a) => a.id === dep.id);
    if (!asset) return "missing";
    const {
      originalPath: _path,
      embedding: _embedding,
      waveform: _waveform,
      thumbnail: _thumbnail,
      ...value
    } = asset;
    return JSON.stringify(value);
  }
  const t = project.timelines.find(
    (t) =>
      t.id ===
      (dep.kind === "timeline" || dep.kind === "timeline-content"
        ? dep.id
        : dep.timelineId),
  );
  return (
    JSON.stringify(
      dep.kind === "clip"
        ? t?.clips.find((c) => c.id === dep.id)
        : dep.kind === "timeline-content"
          ? t
          : t && {
              fps: t.fps,
              width: t.width,
              height: t.height,
              profile: t.profile,
            },
    ) ?? "missing"
  );
}
export function sliceAdvanced(
  advanced: ClipAdvanced | undefined,
  from: number,
  duration: number,
): ClipAdvanced | undefined {
  if (!advanced) return undefined;
  const a = structuredClone(advanced);
  for (const m of a.masks ?? [])
    if (m.keys.length) {
      const at = sampleMask(m, from),
        end = sampleMask(m, from + duration - 1);
      const key = (m: ClipMask, frame: number) => ({
        frame,
        x: m.x,
        y: m.y,
        width: m.width,
        height: m.height,
        rotation: m.rotation,
        feather: m.feather,
      });
      m.keys = [
        key(at, 0),
        ...m.keys
          .filter((k) => k.frame > from && k.frame < from + duration - 1)
          .map((k) => ({ ...k, frame: k.frame - from })),
        ...(duration > 1 ? [key(end, duration - 1)] : []),
      ];
    }
  if (a.tracking) {
    const before =
      [...a.tracking.samples].reverse().find((k) => k.frame <= from) ??
      a.tracking.samples[0];
    a.tracking.samples = [
      { ...before, frame: 0 },
      ...a.tracking.samples
        .filter((k) => k.frame > from && k.frame < from + duration)
        .map((k) => ({ ...k, frame: k.frame - from })),
    ];
  }
  return a;
}

/** Solve the eight homography coefficients with partial-pivot elimination. */
export function homography(from: [number, number][], to: [number, number][]) {
  const rows: number[][] = [];
  from.forEach(([x, y], i) => {
    const [u, v] = to[i];
    rows.push(
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    );
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let i = col + 1; i < 8; i++)
      if (Math.abs(rows[i][col]) > Math.abs(rows[pivot][col])) pivot = i;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    if (Math.abs(divisor) < 1e-9) return undefined;
    for (let j = col; j <= 8; j++) rows[col][j] /= divisor;
    for (let i = 0; i < 8; i++)
      if (i !== col) {
        const factor = rows[i][col];
        for (let j = col; j <= 8; j++) rows[i][j] -= factor * rows[col][j];
      }
  }
  return [...rows.map((r) => r[8]), 1];
}
export function trackingTransform(
  tracking: ClipAdvanced["tracking"],
  frame: number,
  width: number,
  height: number,
  origin: [number, number] = [0.5, 0.5],
) {
  if (!tracking?.samples.length) return "";
  const samples = tracking.samples,
    initial = samples[0];
  const index = samples.findIndex((s) => s.frame >= frame),
    b = index < 0 ? samples.at(-1)! : samples[index],
    a = index > 0 ? samples[index - 1] : b;
  const t = b.frame === a.frame ? 0 : (frame - a.frame) / (b.frame - a.frame);
  const corners = b.corners.map(
    (p, i) =>
      p.map((v, j) => a.corners[i][j] + (v - a.corners[i][j]) * t) as [
        number,
        number,
      ],
  );
  if (tracking.mode === "position") {
    const dx =
      (corners.reduce((s, p, i) => s + p[0] - initial.corners[i][0], 0) *
        width) /
      4;
    const dy =
      (corners.reduce((s, p, i) => s + p[1] - initial.corners[i][1], 0) *
        height) /
      4;
    return `translate(${dx}px,${dy}px)`;
  }
  const px = (p: [number, number]): [number, number] => [
    (p[0] - origin[0]) * width,
    (p[1] - origin[1]) * height,
  ];
  const h = homography(initial.corners.map(px), corners.map(px));
  return h
    ? `matrix3d(${[h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, 1].join(",")})`
    : "";
}

export function rationalFrameRate(fps: number) {
  const standard = standardFrameRates.find(
    (r) => Math.abs(r.numerator / r.denominator - fps) < 0.0001,
  );
  if (standard)
    return { numerator: standard.numerator, denominator: standard.denominator };
  let numerator = Math.round(fps * 1000),
    denominator = 1000;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

export const portraitPresets = [
  {
    id: "natural",
    name: "自然清新",
    values: {
      smooth: 0.2,
      brighten: 0.08,
      faceSlim: 0,
      eyeSize: 0,
      bodySlim: 0,
    },
  },
  {
    id: "portrait",
    name: "柔和人像",
    values: {
      smooth: 0.4,
      brighten: 0.16,
      faceSlim: 0.1,
      eyeSize: 0.05,
      bodySlim: 0,
    },
  },
  {
    id: "definition",
    name: "轻盈轮廓",
    values: {
      smooth: 0.12,
      brighten: 0.06,
      faceSlim: 0.2,
      eyeSize: 0.04,
      bodySlim: 0.12,
    },
  },
] as const;
