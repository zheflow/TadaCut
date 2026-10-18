import { Easing, interpolate, spring, type SpringConfig } from "remotion";
import { BEAT, FPS } from "./timeline";

export const out = Easing.bezier(0.16, 1, 0.3, 1);
export const inOut = Easing.bezier(0.65, 0, 0.35, 1);
export const accel = Easing.bezier(0.7, 0, 0.84, 0);

/** 0 → 1 between two beats. */
export function span(
  frame: number,
  from: number,
  to: number,
  easing: (t: number) => number = out,
) {
  return interpolate(frame, [from * BEAT, to * BEAT], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });
}

/** A spring released on a beat; 0 before it. */
export function pop(
  frame: number,
  beat: number,
  config: Partial<SpringConfig> = {},
) {
  const local = frame - beat * BEAT;
  if (local <= 0) return 0;
  return spring({
    frame: local,
    fps: FPS,
    config: { damping: 15, stiffness: 170, mass: 0.8, ...config },
  });
}

/** A value along [beat, value] keys, eased between neighbours. */
export function keys(
  frame: number,
  points: [number, number][],
  easing: (t: number) => number = inOut,
) {
  const beat = frame / BEAT;
  if (beat <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [b0, v0] = points[i - 1],
      [b1, v1] = points[i];
    if (beat <= b1) return v0 + (v1 - v0) * easing((beat - b0) / (b1 - b0));
  }
  return points[points.length - 1][1];
}

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Short pulse after every beat, for things that breathe with the kick. */
export const pulse = (frame: number) => Math.exp(-(frame % BEAT) / (BEAT / 5));
