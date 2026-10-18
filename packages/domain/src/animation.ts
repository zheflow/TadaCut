import type { Clip, KeyframeProperty } from "./model";
type Keyframe = NonNullable<Clip["keyframes"]["x"]>[number];
/** The y of a CSS cubic-bezier(x1, y1, x2, y2) curve where its x is t. */
export function cubicBezier(
  [x1, y1, x2, y2]: readonly [number, number, number, number],
  t: number,
) {
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx,
    cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by,
    x = (s: number) => ((ax * s + bx) * s + cx) * s,
    slope = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  let s = t;
  for (let i = 0; i < 8; i++) {
    const error = x(s) - t,
      d = slope(s);
    if (Math.abs(error) < 1e-6 || Math.abs(d) < 1e-6) break;
    s -= error / d;
  }
  // Newton can leave the curve on flat stretches; bisection always converges.
  if (!(s >= 0 && s <= 1) || Math.abs(x(s) - t) > 1e-5) {
    let lo = 0,
      hi = 1;
    s = t;
    for (let i = 0; i < 50 && hi - lo > 1e-7; i++) {
      if (x(s) < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
  }
  return ((ay * s + by) * s + cy) * s;
}
export const bezierPresets: Record<
  string,
  { name: string; curve: [number, number, number, number] }
> = {
  ease: { name: "平滑", curve: [0.25, 0.1, 0.25, 1] },
  "ease-in-out-sine": { name: "正弦缓动", curve: [0.37, 0, 0.63, 1] },
  "ease-out-expo": { name: "快速减速", curve: [0.16, 1, 0.3, 1] },
  "ease-in-expo": { name: "快速加速", curve: [0.7, 0, 0.84, 0] },
  "ease-out-back": { name: "回弹", curve: [0.34, 1.56, 0.64, 1] },
  "ease-in-back": { name: "蓄力", curve: [0.36, 0, 0.66, -0.56] },
  anticipate: { name: "预备动作", curve: [0.68, -0.6, 0.32, 1.6] },
};
/** Eases progress t (0–1) from one key toward the next. */
export function easeProgress(
  key: {
    easing: Keyframe["easing"];
    bezier?: readonly [number, number, number, number];
  },
  t: number,
) {
  switch (key.easing) {
    case "hold":
      return 0;
    case "ease-in":
      return t * t;
    case "ease-out":
      return 1 - (1 - t) ** 2;
    case "ease-in-out":
      return t * t * (3 - 2 * t);
    case "bezier":
      return cubicBezier(key.bezier ?? [0.25, 0.1, 0.25, 1], t);
    default:
      return t;
  }
}
export function sampleProperty(
  c: Clip,
  property: KeyframeProperty,
  frame: number,
): number {
  const base =
    property === "focusX" || property === "focusY" ? 0.5 : c[property];
  const keys = c.keyframes[property];
  if (!keys?.length) return base;
  if (frame <= keys[0].frame) return keys[0].value;
  if (frame >= keys[keys.length - 1].frame) return keys[keys.length - 1].value;
  const end = keys.findIndex((k) => k.frame > frame),
    a = keys[end - 1],
    b = keys[end];
  const t = easeProgress(a, (frame - a.frame) / (b.frame - a.frame));
  return a.value + (b.value - a.value) * t;
}
export function clipOpacity(c: Clip, localFrame: number) {
  const fadeIn = c.fadeIn ? Math.min(1, localFrame / c.fadeIn) : 1;
  const fadeOut = c.fadeOut
    ? Math.min(1, (c.duration - localFrame) / c.fadeOut)
    : 1;
  const transition =
    c.transition?.kind === "fade" &&
    localFrame > c.duration - c.transition.duration
      ? 1 -
        (localFrame - c.duration + c.transition.duration) /
          c.transition.duration
      : 1;
  return Math.max(
    0,
    sampleProperty(c, "opacity", localFrame) * fadeIn * fadeOut * transition,
  );
}
/** Preserve the value at a cut boundary, including curves whose next key lies outside the slice. */
export function sliceKeyframes(
  c: Clip,
  start: number,
  duration: number,
): Clip["keyframes"] {
  return Object.fromEntries(
    Object.entries(c.keyframes).map(([property, keys]) => {
      const p = property as KeyframeProperty;
      const values = [
        {
          frame: 0,
          value: sampleProperty(c, p, start),
          easing: keys?.find((k) => k.frame <= start)?.easing ?? "linear",
        },
        ...keys!
          .filter((k) => k.frame > start && k.frame < start + duration)
          .map((k) => ({ ...k, frame: k.frame - start })),
      ];
      if (duration > 1)
        values.push({
          frame: duration - 1,
          value: sampleProperty(c, p, start + duration - 1),
          easing: "linear",
        });
      return [p, [...new Map(values.map((k) => [k.frame, k])).values()]];
    }),
  ) as Clip["keyframes"];
}
export const formatTime = (frame: number, fps = 30) => {
  const total = Math.max(0, Math.floor(frame)),
    seconds = Math.floor(total / Math.round(fps));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}:${String(total % Math.round(fps)).padStart(2, "0")}`;
};
export function focusFromClicks(
  clicks: { time: number; x: number; y: number }[],
  fps: number,
  duration: number,
): Clip["keyframes"] {
  const scale: NonNullable<Clip["keyframes"]["scale"]> = [
    { frame: 0, value: 1, easing: "ease-in-out" },
  ];
  const focusX: NonNullable<Clip["keyframes"]["focusX"]> = [
    { frame: 0, value: 0.5, easing: "ease-in-out" },
  ];
  const focusY = structuredClone(focusX);
  for (const click of clicks) {
    const start = Math.max(1, Math.round(click.time * fps) - 8),
      end = Math.min(duration - 1, start + Math.round(fps * 1.5));
    if (start >= duration - 1) continue;
    scale.push(
      { frame: start, value: 1.75, easing: "ease-in-out" },
      { frame: end, value: 1, easing: "ease-in-out" },
    );
    focusX.push(
      {
        frame: start,
        value: Math.max(0, Math.min(1, click.x)),
        easing: "ease-in-out",
      },
      { frame: end, value: 0.5, easing: "ease-in-out" },
    );
    focusY.push(
      {
        frame: start,
        value: Math.max(0, Math.min(1, click.y)),
        easing: "ease-in-out",
      },
      { frame: end, value: 0.5, easing: "ease-in-out" },
    );
  }
  const dedup = (keys: typeof scale) =>
    [...new Map(keys.map((k) => [k.frame, k])).values()].sort(
      (a, b) => a.frame - b.frame,
    );
  return { scale: dedup(scale), focusX: dedup(focusX), focusY: dedup(focusY) };
}
