import {
  durationInFrames,
  sampleProperty,
  type Asset,
  type Clip,
  type Project,
  type Timeline,
  type TransitionKind,
} from "../../domain/src/index";
export interface LayerPlan {
  clip: Clip;
  asset: Asset;
  local: number;
  transition?: {
    kind: TransitionKind;
    progress: number;
    direction?: "left" | "right" | "up" | "down";
    shader?: string;
  };
}
/** Nested sequences deeper than this are not drawn, which also stops runaway recursion. */
export const maxSequenceDepth = 4;
/** The camera a multicam group shows at a frame, or true when the clip is not in a group. */
const multicamVisible = (timeline: Timeline, c: Clip, frame: number) =>
  timeline.multicam.every((g) => {
    if (!g.cameraClipIds.includes(c.id)) return true;
    const choice =
      [...g.switches].reverse().find((s) => s.frame <= frame)?.clipId ??
      g.cameraClipIds[0];
    return c.id === choice;
  });
export function layersAt(
  timeline: Timeline,
  assets: Asset[],
  frame: number,
): LayerPlan[] {
  return timeline.tracks
    .filter((t) => !t.hidden)
    .flatMap((track) => {
      const clips = timeline.clips
        .filter(
          (c) => c.trackId === track.id && multicamVisible(timeline, c, frame),
        )
        .sort((a, b) => a.start - b.start);
      return clips.flatMap((clip, index) => {
        const asset = assets.find((a) => a.id === clip.assetId);
        if (!asset) return [];
        if (frame >= clip.start && frame < clip.start + clip.duration)
          return [{ clip, asset, local: frame - clip.start }];
        // The next clip starts early, over the end of the previous one.
        const previous = clips[index - 1],
          transition = previous?.transition;
        if (
          !previous ||
          !transition ||
          transition.kind === "fade" ||
          asset.kind === "audio" ||
          previous.start + previous.duration !== clip.start
        )
          return [];
        const duration = Math.min(previous.duration, transition.duration),
          begin = clip.start - duration;
        if (frame < begin || frame >= clip.start) return [];
        return [
          {
            clip,
            asset,
            local: frame - clip.start,
            transition: {
              kind: transition.kind,
              progress: (frame - begin) / duration,
              ...(transition.direction
                ? { direction: transition.direction }
                : {}),
              ...(transition.shader ? { shader: transition.shader } : {}),
            },
          },
        ];
      });
    });
}
/** The frame of a nested sequence's timeline shown at a clip-local frame. */
export function nestedFrame(
  c: Clip,
  local: number,
  parentFps: number,
  nested: Timeline,
) {
  return Math.max(
    0,
    Math.round(
      (c.sourceOffset + (Math.max(0, local) / parentFps) * c.speed) *
        nested.fps,
    ),
  );
}
export const sequenceTimeline = (
  asset: Asset,
  timelines: Timeline[] | undefined,
) =>
  asset.kind === "sequence"
    ? timelines?.find((t) => t.id === asset.sequenceTimelineId)
    : undefined;

/** Gain of a clip at a clip-local frame: volume keyframes, fades and the track level. */
export const clipGain = (c: Clip, frame: number, trackVolume: number) =>
  Math.max(
    0,
    sampleProperty(c, "volume", frame) *
      trackVolume *
      (c.fadeIn ? Math.min(1, frame / c.fadeIn) : 1) *
      (c.fadeOut ? Math.min(1, (c.duration - frame) / c.fadeOut) : 1),
  );
/**
 * One sound to play: a media source placed on the root timeline. Nested
 * sequences are flattened so their sound plays through the same path.
 */
export interface Voice {
  key: string;
  asset: Asset;
  /** Root frames where the sound starts and how long it lasts. */
  start: number;
  duration: number;
  /** Source seconds at the start, and source seconds per root second. */
  sourceStart: number;
  rate: number;
  /** Gain at a voice-local root frame. */
  gain(local: number): number;
}
interface Mapping {
  /** Root frame r maps to this timeline's frame (r - r0) * scale + t0, for r in [lo, hi). */
  r0: number;
  t0: number;
  scale: number;
  lo: number;
  hi: number;
  gain(r: number): number;
  path: string;
}
export function audioVoices(
  root: Timeline,
  assets: Asset[],
  timelines: Timeline[] = [root],
): Voice[] {
  const voices: Voice[] = [];
  const visit = (t: Timeline, m: Mapping, depth: number) => {
    for (const c of t.clips) {
      const asset = assets.find((a) => a.id === c.assetId),
        track = t.tracks.find((x) => x.id === c.trackId);
      if (!asset || !track || track.muted || track.hidden) continue;
      // Only the group's sound clip plays for multicam angles.
      if (
        t.multicam.some(
          (g) =>
            g.cameraClipIds.includes(c.id) &&
            c.id !== (g.audioClipId ?? g.cameraClipIds[0]),
        )
      )
        continue;
      const rootAt = (tf: number) => m.r0 + (tf - m.t0) / m.scale,
        lo = Math.max(m.lo, Math.ceil(rootAt(c.start) - 1e-9)),
        hi = Math.min(m.hi, Math.ceil(rootAt(c.start + c.duration) - 1e-9));
      if (hi <= lo) continue;
      const localAt = (r: number) => (r - m.r0) * m.scale + m.t0 - c.start,
        trackVolume = track.volume;
      if (asset.kind === "sequence") {
        const nested = timelines.find((x) => x.id === asset.sequenceTimelineId);
        if (!nested || depth >= maxSequenceDepth) continue;
        // Nested frames advance by speed × fps ratio per parent frame.
        const step = (c.speed * nested.fps) / t.fps;
        visit(
          nested,
          {
            r0: lo,
            t0: (c.sourceOffset + (localAt(lo) / t.fps) * c.speed) * nested.fps,
            scale: m.scale * step,
            lo,
            hi,
            gain: (r) => m.gain(r) * clipGain(c, localAt(r), trackVolume),
            path: `${m.path}${c.id}/`,
          },
          depth + 1,
        );
        continue;
      }
      if (asset.kind !== "audio" && asset.kind !== "video") continue;
      const first = localAt(lo);
      voices.push({
        key: `${m.path}${c.id}`,
        asset,
        start: lo,
        duration: hi - lo,
        sourceStart: Math.max(0, c.sourceOffset + (first / t.fps) * c.speed),
        rate: (c.speed * m.scale * root.fps) / t.fps,
        gain: (local) =>
          m.gain(lo + local) * clipGain(c, localAt(lo + local), trackVolume),
      });
    }
  };
  visit(
    root,
    {
      r0: 0,
      t0: 0,
      scale: 1,
      lo: 0,
      hi: Infinity,
      gain: () => 1,
      path: "",
    },
    0,
  );
  return voices;
}
export function renderPlan(
  project: Project,
  timeline: Timeline,
  codec: string,
  transparent = false,
) {
  const supported = ["h264", "h265", "vp8", "vp9", "prores", "mp3", "wav"];
  if (!supported.includes(codec)) throw new Error("不支持的导出编码");
  if (transparent && !["vp8", "vp9", "prores"].includes(codec))
    throw new Error("透明背景需要 WebM VP8/VP9 或 ProRes");
  // Media inside nested sequences count as used too.
  const used = new Set<string>(),
    seen = new Set<string>(),
    walk = (t: Timeline) => {
      if (seen.has(t.id)) return;
      seen.add(t.id);
      for (const c of t.clips) {
        used.add(c.assetId);
        const asset = project.assets.find((a) => a.id === c.assetId);
        const nested = asset && sequenceTimeline(asset, project.timelines);
        if (nested) walk(nested);
      }
    };
  walk(timeline);
  const missing = project.assets.filter(
    (a) =>
      used.has(a.id) && ["audio", "video", "image"].includes(a.kind) && !a.url,
  );
  if (missing.length)
    throw new Error("请先重连素材：" + missing.map((a) => a.name).join("、"));
  return {
    fps: timeline.fps,
    width: timeline.width,
    height: timeline.height,
    durationInFrames: Math.max(1, durationInFrames(timeline)),
    extension:
      codec === "prores"
        ? "mov"
        : codec.startsWith("vp")
          ? "webm"
          : codec === "mp3"
            ? "mp3"
            : codec === "wav"
              ? "wav"
              : "mp4",
  };
}
/**
 * Render threads that fit in memory. Each thread is a browser tab holding
 * decoded frames, so 4K takes several times the room of 1080p. Free memory
 * is under-reported on macOS (cached pages count as used), so a share of the
 * total is the floor of the budget.
 */
export function renderConcurrency(
  requested: number,
  width: number,
  height: number,
  memory: { free: number; total: number },
) {
  const perThread = 320 * 2 ** 20 + width * height * 4 * 24,
    budget = Math.max(memory.free * 0.8, memory.total * 0.35),
    fit = Math.max(1, Math.floor(budget / perThread));
  return Math.max(1, Math.min(8, Math.round(requested) || 1, fit));
}
