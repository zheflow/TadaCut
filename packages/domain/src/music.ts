import type { Command } from "./commands";
import { DomainError } from "./engine";
import { clipEnd, diffClips, sliceClip, transcriptText } from "./edits";
import { hasSourceRange } from "./placement";
import { wordsOnTimeline } from "./transcript";
import { clipSchema, type Clip, type Project, type Timeline } from "./model";

/**
 * Editing to music: cuts on beats, slideshows paced by the beat, and
 * shortening a song by whole bars. Beats are seconds into the music source.
 */
type MakeId = () => string;

/** Beats of a music clip as timeline frames, in order. */
export function beatsOnTimeline(t: Timeline, music: Clip, beats: number[]) {
  const end = music.sourceOffset + (music.duration / t.fps) * music.speed;
  return beats
    .filter((b) => b >= music.sourceOffset && b < end)
    .map((b) =>
      Math.round(
        music.start + ((b - music.sourceOffset) / music.speed) * t.fps,
      ),
    );
}
const nearest = (values: number[], target: number) =>
  values.reduce(
    (best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best),
    values[0],
  );
/**
 * Moves each cut between adjacent clips on a track to the nearest beat within
 * tolerance (frames), as roll edits: nothing else on the timeline moves.
 */
export function snapCutsToBeats(
  p: Project,
  t: Timeline,
  trackId: string,
  beatFrames: number[],
  tolerance: number,
): { commands: Command[]; moved: number } {
  const track = t.tracks.find((x) => x.id === trackId);
  if (!track) throw new DomainError("NOT_FOUND", "轨道不存在");
  if (track.locked) throw new DomainError("TRACK_LOCKED", "请先解锁轨道");
  if (!beatFrames.length) throw new DomainError("NO_BEATS", "没有节拍数据");
  const clips = t.clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ ...c }));
  let moved = 0;
  for (let i = 0; i + 1 < clips.length; i++) {
    const left = clips[i],
      right = clips[i + 1];
    if (clipEnd(left) !== right.start) continue;
    const cut = right.start,
      beat = nearest(beatFrames, cut);
    let d = beat - cut;
    if (!d || Math.abs(d) > tolerance) continue;
    const la = p.assets.find((a) => a.id === left.assetId),
      ra = p.assets.find((a) => a.id === right.assetId);
    if (!la || !ra) continue;
    // Keep a frame on each side and stay inside both sources.
    d = Math.max(1 - left.duration, Math.min(right.duration - 1, d));
    if (hasSourceRange(la) && la.duration !== undefined)
      d = Math.min(
        d,
        Math.floor(((la.duration - left.sourceOffset) / left.speed) * t.fps) -
          left.duration,
      );
    if (hasSourceRange(ra))
      d = Math.max(d, -Math.floor((right.sourceOffset / right.speed) * t.fps));
    if (!d) continue;
    const nextRight = sliceRightBy(right, t.fps, d);
    clips[i] = { ...left, duration: left.duration + d };
    clips[i + 1] = nextRight;
    moved++;
  }
  const after = t.clips.map((c) => clips.find((x) => x.id === c.id) ?? c);
  return { commands: diffClips(t.id, t.clips, after), moved };
}
/** The right clip of a cut after the cut moves by d frames. */
function sliceRightBy(c: Clip, fps: number, d: number): Clip {
  if (d > 0)
    return { ...sliceClip(c, fps, d, c.duration - d), fadeIn: c.fadeIn };
  return {
    ...c,
    start: c.start + d,
    duration: c.duration - d,
    sourceOffset: c.sourceOffset + (d / fps) * c.speed,
    keyframes: Object.fromEntries(
      Object.entries(c.keyframes).map(([k, keys]) => [
        k,
        keys!.map((key) => ({ ...key, frame: key.frame - d })),
      ]),
    ) as Clip["keyframes"],
  };
}
/**
 * A slideshow cut to the beat: each asset holds for `beatsPerShot` beats from
 * the first beat at or after `start`, on a free visual track.
 */
export function beatSlideshow(
  p: Project,
  t: Timeline,
  assetIds: string[],
  beatFrames: number[],
  trackId: string,
  makeId: MakeId,
  options: {
    start?: number;
    beatsPerShot?: number;
    transition?: Clip["transition"];
    loop?: boolean;
  } = {},
): Command[] {
  const track = t.tracks.find((x) => x.id === trackId);
  if (!track || (track.kind !== "video" && track.kind !== "motion"))
    throw new DomainError("NOT_FOUND", "需要一条画面轨道");
  if (track.locked) throw new DomainError("TRACK_LOCKED", "请先解锁轨道");
  const per = Math.max(1, Math.round(options.beatsPerShot ?? 2)),
    beats = beatFrames.filter((b) => b >= (options.start ?? 0));
  const assets = assetIds
    .map((id) => p.assets.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> =>
      Boolean(a && ["image", "video", "motion"].includes(a.kind)),
    );
  if (!assets.length)
    throw new DomainError("NO_ASSETS", "请选择图片或视频素材");
  if (beats.length < per + 1)
    throw new DomainError("NO_BEATS", "节拍太少，放不下画面");
  const commands: Command[] = [];
  let shot = 0;
  for (let i = 0; i + per < beats.length; i += per) {
    if (shot >= assets.length && !options.loop) break;
    const asset = assets[shot % assets.length],
      start = beats[i],
      duration = beats[i + per] - start;
    if (duration < 1) continue;
    const clip = clipSchema.parse({
      id: makeId(),
      assetId: asset.id,
      trackId,
      start,
      duration:
        asset.kind === "video" && asset.duration
          ? Math.min(duration, Math.floor(asset.duration * t.fps))
          : duration,
      name: asset.name,
      ...(options.transition ? { transition: options.transition } : {}),
    });
    commands.push({ type: "clip.add", timelineId: t.id, clip });
    shot++;
  }
  const busy = t.clips.filter((c) => c.trackId === trackId);
  const blocked = commands.find(
    (c) =>
      c.type === "clip.add" &&
      busy.some((b) => b.start < clipEnd(c.clip) && c.clip.start < clipEnd(b)),
  );
  if (blocked)
    throw new DomainError(
      "TRACK_BUSY",
      "目标轨道在这段时间已有片段，请换一条轨道",
    );
  return commands;
}
/**
 * Which source ranges (seconds) of a song to keep so it lasts about `target`
 * seconds: whole bars come out of the middle, quietest first when bar energy
 * is known, so the intro and ending stay intact.
 */
export function fitMusic(
  beats: number[],
  duration: number,
  target: number,
  options: {
    beatsPerBar?: number;
    energy?: number[];
    keepIntro?: number;
    keepOutro?: number;
  } = {},
): [number, number][] {
  if (target >= duration) return [[0, duration]];
  const per = options.beatsPerBar ?? 4,
    bars: [number, number][] = [];
  for (let i = 0; i + per < beats.length; i += per)
    bars.push([beats[i], beats[i + per]]);
  if (bars.length < 3)
    throw new DomainError("NO_BEATS", "节拍太少，无法按小节剪短");
  const intro = options.keepIntro ?? 2,
    outro = options.keepOutro ?? 2,
    candidates = bars
      .map((bar, index) => ({ bar, index }))
      .slice(intro, Math.max(intro, bars.length - outro));
  const energyOf = (bar: [number, number]) => {
    const e = options.energy;
    if (!e?.length) return 0;
    const from = Math.floor(bar[0]),
      to = Math.max(from + 1, Math.ceil(bar[1]));
    const slice = e.slice(from, to);
    return slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length);
  };
  // Quietest bars go first; with no energy, bars are taken from the middle out.
  const middle = (bars.length - 1) / 2;
  candidates.sort(
    (a, b) =>
      energyOf(a.bar) - energyOf(b.bar) ||
      Math.abs(a.index - middle) - Math.abs(b.index - middle),
  );
  const removed = new Set<number>();
  let length = duration;
  for (const c of candidates) {
    if (length <= target) break;
    removed.add(c.index);
    length -= c.bar[1] - c.bar[0];
  }
  const keep: [number, number][] = [];
  let cursor = 0;
  [...removed]
    .sort((a, b) => a - b)
    .forEach((i) => {
      const [a, b] = bars[i];
      if (a > cursor) keep.push([cursor, a]);
      cursor = b;
    });
  if (cursor < duration) keep.push([cursor, duration]);
  // Adjacent kept ranges merge back into one.
  return keep.reduce<[number, number][]>((out, r) => {
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - r[0]) < 1e-6) last[1] = r[1];
    else out.push([...r]);
    return out;
  }, []);
}
/** Replaces a music clip with the kept ranges of its source, back to back, with short fades at each join. */
export function cutMusicClip(
  t: Timeline,
  clipId: string,
  keep: [number, number][],
  makeId: MakeId,
): Command[] {
  const c = t.clips.find((x) => x.id === clipId);
  if (!c) throw new DomainError("NOT_FOUND", "片段不存在");
  if (t.tracks.find((x) => x.id === c.trackId)?.locked)
    throw new DomainError("TRACK_LOCKED", "请先解锁轨道");
  const fade = Math.max(1, Math.round(t.fps * 0.04)),
    pieces: Clip[] = [];
  let at = c.start;
  keep.forEach(([a, b], i) => {
    const from = Math.round(((a - c.sourceOffset) / c.speed) * t.fps),
      to = Math.round(((b - c.sourceOffset) / c.speed) * t.fps),
      start = Math.max(0, from),
      end = Math.min(c.duration, to);
    if (end - start < 1) return;
    const piece = sliceClip(c, t.fps, start, end - start, i ? makeId() : c.id);
    piece.start = at;
    if (i) piece.fadeIn = Math.max(piece.fadeIn, fade);
    if (i < keep.length - 1) piece.fadeOut = Math.max(piece.fadeOut, fade);
    pieces.push(piece);
    at += piece.duration;
  });
  if (!pieces.length) throw new DomainError("EMPTY_CUT", "保留范围不在片段里");
  return diffClips(t.id, t.clips, [
    ...t.clips.filter((x) => x.id !== c.id),
    ...pieces,
  ]);
}
/**
 * Shortens a music clip to about `targetSeconds` of timeline time by taking
 * whole bars out of the part of the song it plays. Beats and per-second
 * energy are of the whole source.
 */
export function fitMusicClip(
  t: Timeline,
  clipId: string,
  analysis: { beats: number[]; energy?: number[] },
  targetSeconds: number,
  makeId: MakeId,
  beatsPerBar?: number,
): { commands: Command[]; keptSeconds: number } {
  const music = t.clips.find((c) => c.id === clipId);
  if (!music) throw new DomainError("NOT_FOUND", "片段不存在");
  const start = music.sourceOffset,
    span = (music.duration / t.fps) * music.speed,
    target = targetSeconds * music.speed;
  if (!(target > 0)) throw new DomainError("BAD_TARGET", "目标时长需要大于 0");
  if (target >= span - 1e-6)
    throw new DomainError("NO_CHANGE", "配乐已经不长于目标时长");
  const beats = analysis.beats
      .filter((b) => b >= start && b <= start + span)
      .map((b) => b - start),
    keep = fitMusic(beats, span, target, {
      beatsPerBar,
      energy: analysis.energy?.slice(Math.floor(start)),
    }).map(([x, y]): [number, number] => [x + start, y + start]);
  return {
    commands: cutMusicClip(t, clipId, keep, makeId),
    keptSeconds: keep.reduce((sum, [x, y]) => sum + y - x, 0) / music.speed,
  };
}
/** Per-second loudness of a clip's source laid out on timeline seconds, 0 outside the clip. */
export function energyOnTimeline(t: Timeline, c: Clip, energy: number[]) {
  return Array.from({ length: Math.ceil(clipEnd(c) / t.fps) }, (_, second) => {
    const local = second - c.start / t.fps;
    if (local < 0 || local * t.fps >= c.duration) return 0;
    return energy[Math.floor(c.sourceOffset + local * c.speed)] ?? 0;
  });
}
export interface Highlight {
  start: number;
  end: number;
  score: number;
  text: string;
  reasons: string[];
}
/**
 * Candidate highlights on a timeline: windows where speech is dense and
 * lively (exclamations, questions, laughter) and the sound is energetic.
 * Energy is one RMS value per timeline second, when known. The agent or a
 * model can rerank these by meaning.
 */
export function highlightWindows(
  p: Project,
  t: Timeline,
  options: { length?: number; count?: number; energy?: number[] } = {},
): Highlight[] {
  const length = Math.max(1, options.length ?? 15) * t.fps,
    total = Math.max(1, ...t.clips.map(clipEnd)),
    words = p.transcripts.flatMap((tr) => wordsOnTimeline(tr, t)),
    energy = options.energy ?? [],
    peak = Math.max(1e-6, ...energy),
    step = Math.max(1, Math.round(t.fps * 2)),
    windows: Highlight[] = [];
  for (let start = 0; start + Math.min(length, total) <= total; start += step) {
    const end = Math.min(total, start + length),
      inside = words.filter((w) => w.start >= start && w.end <= end),
      text = transcriptText(inside.map((w) => w.word)).text,
      reasons: string[] = [];
    let score = 0;
    const density = inside.length / ((end - start) / t.fps);
    if (inside.length) {
      score += Math.min(1, density / 3);
      if (density > 2) reasons.push("语速紧凑");
    }
    const lively = (text.match(/[!！?？]|哈哈|笑|wow|天哪|太/gi) ?? []).length;
    if (lively) {
      score += Math.min(0.6, lively * 0.15);
      reasons.push("情绪起伏");
    }
    if (energy.length) {
      const slice = energy.slice(
          Math.floor(start / t.fps),
          Math.ceil(end / t.fps),
        ),
        mean = slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length);
      score += (mean / peak) * 0.8;
      if (mean / peak > 0.6) reasons.push("声音饱满");
    }
    windows.push({ start, end, score, text: text.slice(0, 120), reasons });
  }
  // Best first, without overlapping picks.
  const picked: Highlight[] = [];
  for (const w of windows.sort((a, b) => b.score - a.score)) {
    if (picked.length >= (options.count ?? 5)) break;
    if (picked.some((x) => x.start < w.end && w.start < x.end)) continue;
    picked.push(w);
  }
  return picked.sort((a, b) => a.start - b.start);
}
