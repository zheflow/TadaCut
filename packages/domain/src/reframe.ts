import {
  clipSchema,
  timelineSchema,
  type Asset,
  type Clip,
  type KeyframeProperty,
  type Timeline,
} from "./model";

export const framePresets = [
  { id: "9:16", name: "竖屏 9:16", width: 1080, height: 1920 },
  { id: "1:1", name: "方形 1:1", width: 1080, height: 1080 },
  { id: "4:5", name: "竖版 4:5", width: 1080, height: 1350 },
  { id: "16:9", name: "横屏 16:9", width: 1920, height: 1080 },
] as const;
export type FramePreset = (typeof framePresets)[number];
/** A subject center at a clip-local frame, as fractions of the source width and height. */
export interface SubjectSample {
  frame: number;
  x: number;
  y: number;
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Fractions of the source width and height that a cover fit keeps inside the frame. */
export function coverWindow(
  source: { width: number; height: number },
  frame: { width: number; height: number },
) {
  const s = source.width / source.height,
    f = frame.width / frame.height;
  return { x: Math.min(1, f / s), y: Math.min(1, s / f) };
}
/**
 * The object-position (0–1) that puts a subject in the middle of a cover crop.
 * `visible` is the fraction of that source axis the frame shows.
 */
export function coverPosition(subject: number, visible: number) {
  if (visible >= 1) return 0.5;
  return clamp01((subject - visible / 2) / (1 - visible));
}
/** Neighbor averaging keeps a detector's frame-to-frame jitter out of the virtual camera. */
const smooth = (values: number[]) =>
  values.map((v, i) => {
    const near = values.slice(Math.max(0, i - 1), i + 2);
    return near.reduce((a, b) => a + b, 0) / near.length;
  });
function followKeys(
  samples: SubjectSample[],
  axis: "x" | "y",
  visible: number,
  known: boolean,
  duration: number,
) {
  const inside = samples.filter((s) => s.frame < duration),
    centers = smooth(inside.map((s) => s[axis]));
  return inside.map((s, i) => ({
    frame: s.frame,
    // Without source dimensions the crop width is unknown; the subject center is the closest guess.
    value: known ? coverPosition(centers[i], visible) : clamp01(centers[i]),
    easing: "ease-in-out" as const,
  }));
}
/**
 * A copy of a timeline in another frame size. Positions keep their relative
 * place, text keeps its size against the short side, and covered media follow
 * the detected subjects when samples are given.
 */
export function reframeTimeline(
  source: Timeline,
  assets: Asset[],
  target: { id: string; name: string; width: number; height: number },
  subjects: Record<string, SubjectSample[]> = {},
): Timeline {
  const sx = target.width / source.width,
    sy = target.height / source.height,
    textScale =
      Math.min(target.width, target.height) /
      Math.min(source.width, source.height);
  const trackIds = new Map(
      source.tracks.map((t, i) => [t.id, `${target.id}-track-${i + 1}`]),
    ),
    clipIds = new Map(
      source.clips.map((c, i) => [c.id, `${target.id}-clip-${i + 1}`]),
    );
  const scaled = (c: Clip, property: KeyframeProperty, factor: number) =>
    c.keyframes[property]?.map((k) => ({ ...k, value: k.value * factor }));
  const clips = source.clips.map((c) => {
    const asset = assets.find((a) => a.id === c.assetId),
      keyframes = { ...c.keyframes };
    for (const [property, factor] of [
      ["x", sx],
      ["y", sy],
    ] as const) {
      const keys = scaled(c, property, factor);
      if (keys) keyframes[property] = keys;
    }
    const samples = subjects[c.id];
    if (
      samples?.length &&
      asset &&
      (asset.kind === "video" || asset.kind === "image") &&
      c.fit === "cover"
    ) {
      const known = Boolean(asset.width && asset.height),
        // Unprobed media are assumed to be landscape to decide which axis is cropped.
        window = coverWindow(
          known
            ? { width: asset.width!, height: asset.height! }
            : { width: 16, height: 9 },
          target,
        );
      if (window.x < 1)
        keyframes.focusX = followKeys(
          samples,
          "x",
          window.x,
          known,
          c.duration,
        );
      if (window.y < 1)
        keyframes.focusY = followKeys(
          samples,
          "y",
          window.y,
          known,
          c.duration,
        );
    }
    return clipSchema.parse({
      ...c,
      id: clipIds.get(c.id),
      trackId: trackIds.get(c.trackId),
      x: c.x * sx,
      y: c.y * sy,
      keyframes,
      ...(c.textStyle
        ? {
            textStyle: {
              ...c.textStyle,
              fontSize: Math.min(
                300,
                Math.max(8, Math.round(c.textStyle.fontSize * textScale)),
              ),
            },
          }
        : {}),
    });
  });
  return timelineSchema.parse({
    ...source,
    id: target.id,
    name: target.name,
    width: target.width,
    height: target.height,
    tracks: source.tracks.map((t) => ({ ...t, id: trackIds.get(t.id) })),
    clips,
    multicam: source.multicam.map((g) => ({
      ...g,
      cameraClipIds: g.cameraClipIds.map((id) => clipIds.get(id) ?? id),
      switches: g.switches.map((s) => ({
        ...s,
        clipId: clipIds.get(s.clipId) ?? s.clipId,
      })),
      ...(g.audioClipId
        ? { audioClipId: clipIds.get(g.audioClipId) ?? g.audioClipId }
        : {}),
    })),
  });
}
