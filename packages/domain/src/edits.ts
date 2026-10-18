import type { Command } from "./commands";
import { sampleProperty, sliceKeyframes } from "./animation";
import { DomainError } from "./engine";
import { hasSourceRange } from "./placement";
import { wordsOnTimeline } from "./transcript";
import {
  assetSchema,
  clipSchema,
  makeTimeline,
  timelineSchema,
  type Asset,
  type Clip,
  type KeyframeProperty,
  type Project,
  type Timeline,
  type Transcript,
  type Word,
} from "./model";

/**
 * Edit planners. Each one reads the project and returns the validated
 * commands that make the edit, so callers commit it as one transaction (one
 * undo step) and the engine still checks every change.
 */
type MakeId = () => string;
export const clipEnd = (c: Pick<Clip, "start" | "duration">) =>
  c.start + c.duration;
const trackOf = (t: Timeline, trackId: string) => {
  const track = t.tracks.find((x) => x.id === trackId);
  if (!track) throw new DomainError("NOT_FOUND", "轨道不存在");
  return track;
};
const assertUnlocked = (t: Timeline, trackId: string) => {
  if (trackOf(t, trackId).locked)
    throw new DomainError("TRACK_LOCKED", "请先解锁轨道");
};
const clipOf = (t: Timeline, clipId: string) => {
  const c = t.clips.find((x) => x.id === clipId);
  if (!c) throw new DomainError("NOT_FOUND", "片段不存在");
  return c;
};
const assetOf = (p: Project, c: Clip) => {
  const asset = p.assets.find((a) => a.id === c.assetId);
  if (!asset) throw new DomainError("NOT_FOUND", "素材不存在");
  return asset;
};
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * A part of a clip, clip-local frames [from, from + duration), as a clip that
 * starts where that part played. Fades and the outgoing transition stay on
 * the outer edges.
 */
export function sliceClip(
  c: Clip,
  fps: number,
  from: number,
  duration: number,
  id = c.id,
): Clip {
  const next: Clip = {
    ...structuredClone(c),
    id,
    start: c.start + from,
    duration,
    sourceOffset: c.sourceOffset + (from / fps) * c.speed,
    keyframes: sliceKeyframes(c, from, duration),
  };
  if (c.caption?.words)
    next.caption = {
      ...c.caption,
      words: c.caption.words
        .filter((w) => w.end > from && w.start < from + duration)
        .map((w) => ({
          ...w,
          start: Math.max(0, w.start - from),
          end: Math.min(duration, w.end - from),
        })),
    };
  if (from > 0) next.fadeIn = 0;
  if (from + duration < c.duration) {
    next.fadeOut = 0;
    delete next.transition;
  }
  return next;
}

/**
 * Commands that turn one clip list into another: removals first, then
 * updates, then additions. A clip that lost an optional field is replaced,
 * since a JSON patch cannot carry "remove this field".
 */
export function diffClips(
  timelineId: string,
  before: Clip[],
  after: Clip[],
): Command[] {
  const old = new Map(before.map((c) => [c.id, c])),
    next = new Set(after.map((c) => c.id)),
    removes: Command[] = [],
    updates: Command[] = [],
    adds: Command[] = [];
  for (const c of before)
    if (!next.has(c.id))
      removes.push({
        type: "clip.remove",
        timelineId,
        clipId: c.id,
        ripple: false,
      });
  for (const c of after) {
    const previous = old.get(c.id);
    if (!previous) {
      adds.push({ type: "clip.add", timelineId, clip: clipSchema.parse(c) });
      continue;
    }
    const keys = new Set([...Object.keys(previous), ...Object.keys(c)]) as Set<
        keyof Clip
      >,
      patch: Record<string, unknown> = {};
    let dropped = false;
    for (const key of keys) {
      if (key === "id") continue;
      if (JSON.stringify(previous[key]) === JSON.stringify(c[key])) continue;
      if (c[key] === undefined) dropped = true;
      else patch[key] = c[key];
    }
    if (dropped) {
      removes.push({
        type: "clip.remove",
        timelineId,
        clipId: c.id,
        ripple: false,
      });
      adds.push({ type: "clip.add", timelineId, clip: clipSchema.parse(c) });
    } else if (Object.keys(patch).length)
      updates.push({
        type: "clip.update",
        timelineId,
        clipId: c.id,
        patch,
      } as Command);
  }
  return [...removes, ...updates, ...adds];
}

/** The clips plus every clip linked to them, such as a picture's own sound. */
export function withLinked(t: Timeline, clipIds: Iterable<string>) {
  const ids = new Set(clipIds),
    links = new Set(
      t.clips.filter((c) => ids.has(c.id) && c.linkId).map((c) => c.linkId!),
    );
  for (const c of t.clips) if (c.linkId && links.has(c.linkId)) ids.add(c.id);
  return [...ids];
}

/**
 * Removes frames [a, b) from one track's clips. Clips inside go, clips that
 * cross an edge are cut there, and with `close` everything after b moves left.
 */
function removeRange(
  clips: Clip[],
  a: number,
  b: number,
  fps: number,
  makeId: MakeId,
  close: boolean,
): Clip[] {
  const length = b - a,
    out: Clip[] = [];
  for (const c of clips) {
    const end = clipEnd(c);
    if (end <= a) out.push(c);
    else if (c.start >= b)
      out.push(close ? { ...c, start: c.start - length } : c);
    else {
      if (c.start < a) out.push(sliceClip(c, fps, 0, a - c.start));
      if (end > b) {
        const from = b - c.start,
          right = sliceClip(
            c,
            fps,
            from,
            end - b,
            c.start < a ? makeId() : c.id,
          );
        out.push(close ? { ...right, start: a } : right);
      }
    }
  }
  return out;
}
/** Opens `length` frames at a frame on one track's clips, cutting a clip that spans it. */
function openRange(
  clips: Clip[],
  at: number,
  length: number,
  fps: number,
  makeId: MakeId,
): Clip[] {
  return clips.flatMap((c) => {
    if (c.start >= at) return [{ ...c, start: c.start + length }];
    if (clipEnd(c) <= at) return [c];
    const left = sliceClip(c, fps, 0, at - c.start),
      right = sliceClip(c, fps, at - c.start, clipEnd(c) - at, makeId());
    return [left, { ...right, start: right.start + length }];
  });
}
const mergeRanges = (ranges: [number, number][]) => {
  const sorted = ranges.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]),
    out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
};
/** Sync-locked tracks that follow ripple edits made on other tracks. */
const syncLocked = (t: Timeline, edited: Set<string>) =>
  t.tracks
    .filter((x) => x.syncLock && !x.locked && !edited.has(x.id))
    .map((x) => x.id);
/** Applies per-track clip edits and returns the commands. */
function rewrite(
  t: Timeline,
  edit: (clips: Clip[], trackId: string) => Clip[],
  trackIds: Iterable<string>,
) {
  const tracks = new Set(trackIds),
    after = t.tracks.flatMap((track) => {
      const own = t.clips
        .filter((c) => c.trackId === track.id)
        .sort((a, b) => a.start - b.start);
      return tracks.has(track.id) ? edit(own, track.id) : own;
    });
  return diffClips(t.id, t.clips, after);
}

/** Deletes clips (and their linked clips) and closes the gaps they leave. */
export function rippleDelete(
  t: Timeline,
  clipIds: string[],
  makeId: MakeId,
): Command[] {
  const ids = new Set(withLinked(t, clipIds)),
    removed = t.clips.filter((c) => ids.has(c.id));
  if (!removed.length) throw new DomainError("NOT_FOUND", "片段不存在");
  removed.forEach((c) => assertUnlocked(t, c.trackId));
  const ranges = new Map<string, [number, number][]>();
  for (const c of removed)
    ranges.set(c.trackId, [
      ...(ranges.get(c.trackId) ?? []),
      [c.start, clipEnd(c)],
    ]);
  for (const [k, v] of ranges) ranges.set(k, mergeRanges(v));
  const followers = syncLocked(t, new Set(ranges.keys())),
    shapes = new Set([...ranges.values()].map((r) => JSON.stringify(r)));
  if (followers.length && shapes.size > 1)
    throw new DomainError(
      "SYNC_LOCK",
      "所选片段在各轨道上的时间不同，无法让同步锁定的轨道保持对齐；请分开删除或关闭同步锁定",
    );
  const shared = [...ranges.values()][0];
  return rewrite(
    t,
    (clips, trackId) => {
      let out = clips.filter((c) => !ids.has(c.id));
      // Later ranges first, so earlier frames are unchanged while cutting.
      for (const [a, b] of [...(ranges.get(trackId) ?? shared)].reverse())
        out = removeRange(out, a, b, t.fps, makeId, true);
      return out;
    },
    [...ranges.keys(), ...followers],
  );
}

/** Closes the empty span around a frame on a track, moving later clips left. */
export function rippleDeleteGap(
  t: Timeline,
  trackId: string,
  frame: number,
  makeId: MakeId,
): Command[] {
  assertUnlocked(t, trackId);
  const own = t.clips.filter((c) => c.trackId === trackId);
  if (own.some((c) => c.start <= frame && frame < clipEnd(c)))
    throw new DomainError("NOT_A_GAP", "这里不是空隙");
  const a = Math.max(0, ...own.filter((c) => clipEnd(c) <= frame).map(clipEnd)),
    later = own.filter((c) => c.start > frame).map((c) => c.start),
    b = later.length ? Math.min(...later) : NaN;
  if (!Number.isFinite(b) || b <= a)
    throw new DomainError("NOT_A_GAP", "这段空隙后面没有片段");
  const followers = syncLocked(t, new Set([trackId])),
    blocked = t.clips.find(
      (c) => followers.includes(c.trackId) && c.start < b && a < clipEnd(c),
    );
  if (blocked)
    throw new DomainError(
      "SYNC_LOCK",
      `同步锁定轨道上的「${blocked.name || "片段"}」位于这段空隙内，无法波纹删除`,
    );
  return rewrite(t, (clips) => removeRange(clips, a, b, t.fps, makeId, true), [
    trackId,
    ...followers,
  ]);
}

/** Closes every gap on the tracks (all unlocked tracks by default), keeping order. Linked clips on other tracks move with their partners. */
export function closeGaps(t: Timeline, trackIds?: string[]): Command[] {
  const tracks = (trackIds ?? t.tracks.map((x) => x.id)).filter(
      (id) => !trackOf(t, id).locked,
    ),
    chosen = new Set(tracks),
    shift = new Map<string, number>();
  for (const trackId of tracks) {
    let cursor = 0;
    for (const c of t.clips
      .filter((c) => c.trackId === trackId)
      .sort((a, b) => a.start - b.start)) {
      const start = Math.min(c.start, cursor);
      if (start !== c.start) shift.set(c.id, start - c.start);
      cursor = Math.max(cursor, start + c.duration);
    }
  }
  // Partners on tracks that were not closed follow the clip they are linked to.
  const linkShift = new Map<string, number>();
  for (const c of t.clips)
    if (c.linkId && shift.has(c.id) && !linkShift.has(c.linkId))
      linkShift.set(c.linkId, shift.get(c.id)!);
  const after = t.clips.map((c) => {
    const delta =
      shift.get(c.id) ??
      (c.linkId && !chosen.has(c.trackId) && !trackOf(t, c.trackId).locked
        ? linkShift.get(c.linkId)
        : undefined);
    return delta ? { ...c, start: Math.max(0, c.start + delta) } : c;
  });
  return diffClips(t.id, t.clips, after);
}

/**
 * Inserts clips at their start frame, pushing everything at or after it on
 * their tracks and on sync-locked tracks to the right.
 */
export function insertEdit(
  p: Project,
  t: Timeline,
  clips: Clip[],
  makeId: MakeId,
): Command[] {
  if (!clips.length) return [];
  const at = clips[0].start;
  if (clips.some((c) => c.start !== at))
    throw new DomainError("INSERT_START", "插入的片段需要从同一帧开始");
  const length = Math.max(...clips.map((c) => c.duration)),
    edited = new Set(clips.map((c) => c.trackId));
  clips.forEach((c) => {
    assertUnlocked(t, c.trackId);
    assetOf(p, c);
  });
  const commands = rewrite(
    t,
    (own) => openRange(own, at, length, t.fps, makeId),
    [...edited, ...syncLocked(t, edited)],
  );
  return [
    ...commands,
    ...clips.map(
      (clip): Command => ({
        type: "clip.add",
        timelineId: t.id,
        clip: clipSchema.parse(clip),
      }),
    ),
  ];
}

/** Places clips over whatever is on their tracks at that time, cutting it away. */
export function overwriteEdit(
  p: Project,
  t: Timeline,
  clips: Clip[],
  makeId: MakeId,
): Command[] {
  clips.forEach((c) => {
    assertUnlocked(t, c.trackId);
    assetOf(p, c);
  });
  const byTrack = new Map<string, [number, number][]>();
  for (const c of clips)
    byTrack.set(c.trackId, [
      ...(byTrack.get(c.trackId) ?? []),
      [c.start, clipEnd(c)],
    ]);
  const commands = rewrite(
    t,
    (own, trackId) => {
      let out = own;
      for (const [a, b] of mergeRanges(byTrack.get(trackId)!))
        out = removeRange(out, a, b, t.fps, makeId, false);
      return out;
    },
    byTrack.keys(),
  );
  return [
    ...commands,
    ...clips.map(
      (clip): Command => ({
        type: "clip.add",
        timelineId: t.id,
        clip: clipSchema.parse(clip),
      }),
    ),
  ];
}

/** How far a clip's source can move, in seconds, keeping its length. */
function sourceLimit(c: Clip, asset: Asset, fps: number) {
  const span = (c.duration / fps) * c.speed;
  return asset.duration === undefined
    ? Infinity
    : Math.max(0, asset.duration - span);
}

/** Slip: shows an earlier or later part of the source without moving the clip. Linked clips slip with it. */
export function slipClip(
  p: Project,
  t: Timeline,
  clipId: string,
  frames: number,
): Command[] {
  const target = clipOf(t, clipId);
  if (!hasSourceRange(assetOf(p, target)))
    throw new DomainError("NO_SOURCE_RANGE", "只有视频和音频片段可以滑移");
  const seconds = (frames / t.fps) * target.speed,
    ids = new Set(withLinked(t, [clipId]));
  const after = t.clips.map((c) => {
    if (!ids.has(c.id)) return c;
    assertUnlocked(t, c.trackId);
    const asset = assetOf(p, c);
    if (!hasSourceRange(asset)) return c;
    return {
      ...c,
      sourceOffset: clamp(
        c.sourceOffset + seconds,
        0,
        sourceLimit(c, asset, t.fps),
      ),
    };
  });
  return diffClips(t.id, t.clips, after);
}

/** Trims the end of `left` and the start of `right` by the same frames, so the cut between adjacent clips moves. */
export function rollEdit(
  p: Project,
  t: Timeline,
  leftId: string,
  rightId: string,
  frames: number,
): Command[] {
  const left = clipOf(t, leftId),
    right = clipOf(t, rightId);
  if (left.trackId !== right.trackId || clipEnd(left) !== right.start)
    throw new DomainError(
      "NOT_ADJACENT",
      "滚动编辑需要同一轨道上相邻的两个片段",
    );
  assertUnlocked(t, left.trackId);
  const leftAsset = assetOf(p, left),
    rightAsset = assetOf(p, right);
  let d = Math.round(frames);
  // Bounded by both clips keeping a frame and by the media each can show.
  d = clamp(d, 1 - left.duration, right.duration - 1);
  if (hasSourceRange(leftAsset) && leftAsset.duration !== undefined)
    d = Math.min(
      d,
      Math.floor(
        ((leftAsset.duration - left.sourceOffset) / left.speed) * t.fps,
      ) - left.duration,
    );
  if (hasSourceRange(rightAsset))
    d = Math.max(d, -Math.floor((right.sourceOffset / right.speed) * t.fps));
  if (!d) return [];
  const nextLeft: Clip = {
      ...left,
      duration: left.duration + d,
      keyframes:
        d < 0 ? sliceKeyframes(left, 0, left.duration + d) : left.keyframes,
    },
    nextRight: Clip =
      d > 0
        ? sliceClip(right, t.fps, d, right.duration - d)
        : {
            ...right,
            start: right.start + d,
            duration: right.duration - d,
            sourceOffset: right.sourceOffset + (d / t.fps) * right.speed,
            keyframes: shiftKeyframes(right.keyframes, -d),
          };
  nextRight.fadeIn = right.fadeIn;
  return diffClips(
    t.id,
    t.clips,
    t.clips.map((c) =>
      c.id === left.id ? nextLeft : c.id === right.id ? nextRight : c,
    ),
  );
}
const shiftKeyframes = (keys: Clip["keyframes"], by: number) =>
  Object.fromEntries(
    Object.entries(keys).map(([k, list]) => [
      k,
      list!.map((key) => ({ ...key, frame: key.frame + by })),
    ]),
  ) as Clip["keyframes"];

/** Slide: moves a clip between its neighbors, which give up or take the frames, so nothing else moves. */
export function slideClip(
  p: Project,
  t: Timeline,
  clipId: string,
  frames: number,
): Command[] {
  const c = clipOf(t, clipId);
  assertUnlocked(t, c.trackId);
  const own = t.clips.filter((x) => x.trackId === c.trackId && x.id !== c.id),
    left = own.find((x) => clipEnd(x) === c.start),
    right = own.find((x) => x.start === clipEnd(c));
  if (!left || !right)
    throw new DomainError(
      "NOT_ADJACENT",
      "滑动编辑需要片段两侧都紧挨着其他片段",
    );
  // Moving right by d rolls both cuts by d.
  const moved = Math.round(frames);
  if (!moved) return [];
  const shiftedLeft: Clip = {
      ...left,
      duration: left.duration + moved,
      keyframes:
        moved < 0
          ? sliceKeyframes(left, 0, left.duration + moved)
          : left.keyframes,
    },
    shiftedRight: Clip =
      moved > 0
        ? sliceClip(right, t.fps, moved, right.duration - moved)
        : {
            ...right,
            start: right.start + moved,
            duration: right.duration - moved,
            sourceOffset: right.sourceOffset + (moved / t.fps) * right.speed,
            keyframes: shiftKeyframes(right.keyframes, -moved),
          };
  shiftedRight.fadeIn = right.fadeIn;
  if (shiftedLeft.duration < 1 || shiftedRight.duration < 1)
    throw new DomainError("SLIDE_LIMIT", "相邻片段的长度不够");
  for (const [clip, asset] of [
    [shiftedLeft, assetOf(p, left)],
    [shiftedRight, assetOf(p, right)],
  ] as const)
    if (
      hasSourceRange(asset) &&
      (clip.sourceOffset < 0 ||
        (asset.duration !== undefined &&
          clip.sourceOffset + (clip.duration / t.fps) * clip.speed >
            asset.duration + 1e-6))
    )
      throw new DomainError("SLIDE_LIMIT", "相邻片段的素材长度不够");
  return diffClips(
    t.id,
    t.clips,
    t.clips.map((x) =>
      x.id === left.id
        ? shiftedLeft
        : x.id === right.id
          ? shiftedRight
          : x.id === c.id
            ? { ...c, start: c.start + moved }
            : x,
    ),
  );
}

/** Trims one edge of a clip and moves later clips on its track (and sync-locked tracks) to follow. */
export function rippleTrim(
  p: Project,
  t: Timeline,
  clipId: string,
  edge: "start" | "end",
  frames: number,
  makeId: MakeId,
): Command[] {
  const c = clipOf(t, clipId);
  assertUnlocked(t, c.trackId);
  const asset = assetOf(p, c),
    source = hasSourceRange(asset);
  let d = Math.round(frames);
  if (edge === "end") {
    d = Math.max(d, 1 - c.duration);
    if (source && asset.duration !== undefined)
      d = Math.min(
        d,
        Math.floor(((asset.duration - c.sourceOffset) / c.speed) * t.fps) -
          c.duration,
      );
  } else {
    // A positive change removes frames from the head.
    d = Math.min(d, c.duration - 1);
    if (source)
      d = Math.max(d, -Math.floor((c.sourceOffset / c.speed) * t.fps));
  }
  if (!d) return [];
  const end = clipEnd(c),
    change = edge === "end" ? d : -d,
    edited = new Set([c.trackId]),
    followers = syncLocked(t, edited);
  const trimmed: Clip =
    edge === "end"
      ? {
          ...c,
          duration: c.duration + d,
          keyframes: d < 0 ? sliceKeyframes(c, 0, c.duration + d) : c.keyframes,
        }
      : d > 0
        ? { ...sliceClip(c, t.fps, d, c.duration - d), start: c.start }
        : {
            ...c,
            duration: c.duration - d,
            sourceOffset: c.sourceOffset + (d / t.fps) * c.speed,
            keyframes: shiftKeyframes(c.keyframes, -d),
          };
  if (edge === "start") trimmed.fadeIn = c.fadeIn;
  return rewrite(
    t,
    (clips, trackId) => {
      if (trackId === c.trackId)
        return clips.map((x) =>
          x.id === c.id
            ? trimmed
            : x.start >= end
              ? { ...x, start: x.start + change }
              : x,
        );
      return change > 0
        ? openRange(clips, end, change, t.fps, makeId)
        : removeRange(clips, end + change, end, t.fps, makeId, true);
    },
    [c.trackId, ...followers],
  );
}

/** Copies clips to start at a frame (by default after the last clip on their tracks), keeping their relative timing and links. */
export function duplicateClips(
  t: Timeline,
  clipIds: string[],
  makeId: MakeId,
  at?: number,
): Command[] {
  const source = t.clips.filter((c) => clipIds.includes(c.id));
  if (!source.length) throw new DomainError("NOT_FOUND", "片段不存在");
  const tracks = new Set(source.map((c) => c.trackId));
  tracks.forEach((id) => assertUnlocked(t, id));
  const base = Math.min(...source.map((c) => c.start)),
    origin =
      at ??
      Math.max(...t.clips.filter((c) => tracks.has(c.trackId)).map(clipEnd)),
    renamed = new Map<string, string>(),
    rename = (value?: string) => {
      if (!value) return undefined;
      if (!renamed.has(value)) renamed.set(value, makeId());
      return renamed.get(value);
    };
  return source.map(({ shotId: _shot, ...c }): Command => {
    const copy: Clip = {
      ...structuredClone(c),
      id: makeId(),
      start: origin + c.start - base,
    };
    const linkId = rename(c.linkId),
      groupId = rename(c.groupId);
    if (linkId) copy.linkId = linkId;
    if (groupId) copy.groupId = groupId;
    return { type: "clip.add", timelineId: t.id, clip: clipSchema.parse(copy) };
  });
}

export const layouts = [
  "full",
  "pip-tl",
  "pip-tr",
  "pip-bl",
  "pip-br",
  "side-by-side",
  "top-bottom",
  "split-3",
  "grid-2x2",
  "grid-3x3",
] as const;
export type Layout = (typeof layouts)[number];
export const layoutNames: Record<Layout, string> = {
  full: "全屏",
  "pip-tl": "画中画 · 左上",
  "pip-tr": "画中画 · 右上",
  "pip-bl": "画中画 · 左下",
  "pip-br": "画中画 · 右下",
  "side-by-side": "左右分屏",
  "top-bottom": "上下分屏",
  "split-3": "三栏",
  "grid-2x2": "四宫格",
  "grid-3x3": "九宫格",
};
/** Cells as [left, top, width, height] fractions of the frame. */
export function layoutCells(
  layout: Layout,
  count: number,
  pipSize = 0.3,
  aspect = 16 / 9,
) {
  const grid = (cols: number, rows: number) =>
    Array.from({ length: cols * rows }, (_, i) => [
      (i % cols) / cols,
      Math.floor(i / cols) / rows,
      1 / cols,
      1 / rows,
    ]);
  const margin = 0.04;
  const corner = (right: boolean, bottom: boolean) => [
    right ? 1 - margin - pipSize : margin,
    bottom ? 1 - margin * aspect - pipSize : margin * aspect,
    pipSize,
    pipSize,
  ];
  const cells: Record<Layout, number[][]> = {
    full: [[0, 0, 1, 1]],
    "pip-tl": [[0, 0, 1, 1], corner(false, false)],
    "pip-tr": [[0, 0, 1, 1], corner(true, false)],
    "pip-bl": [[0, 0, 1, 1], corner(false, true)],
    "pip-br": [[0, 0, 1, 1], corner(true, true)],
    "side-by-side": grid(2, 1),
    "top-bottom": grid(1, 2),
    "split-3": grid(3, 1),
    "grid-2x2": grid(2, 2),
    "grid-3x3": grid(3, 3),
  };
  const all = cells[layout];
  // One clip in a picture-in-picture layout is the inset itself.
  return (layout.startsWith("pip") && count === 1 ? all.slice(1) : all).slice(
    0,
    Math.max(1, count),
  ) as [number, number, number, number][];
}
const layoutKeys: KeyframeProperty[] = [
  "x",
  "y",
  "scale",
  "scaleX",
  "scaleY",
  "rotation",
  "radius",
];
/**
 * Arranges clips (in the given order) into a layout. Each clip fills its
 * cell like `cover`: scaled to the larger side and cropped to the cell, with
 * an optional gap between cells and rounded corners.
 */
export function applyLayout(
  t: Timeline,
  clipIds: string[],
  layout: Layout,
  options: { gap?: number; radius?: number; pipSize?: number } = {},
): Command[] {
  const clips = clipIds.map((id) => clipOf(t, id));
  clips.forEach((c) => assertUnlocked(t, c.trackId));
  const cells = layoutCells(
      layout,
      clips.length,
      options.pipSize,
      t.width / t.height,
    ),
    gap = clamp(options.gap ?? 0, 0, 0.1),
    pip = layout.startsWith("pip");
  return clips.slice(0, cells.length).map((c, i): Command => {
    let [left, top, width, height] = cells[i];
    const inset = cells[i][2] < 1 || cells[i][3] < 1 ? gap / 2 : 0;
    left += inset;
    top += inset;
    width -= inset * 2;
    height -= inset * 2;
    const scale = Math.max(width, height),
      cropX = (1 - width / scale) / 2,
      cropY = (1 - height / scale) / 2,
      keyframes = Object.fromEntries(
        Object.entries(c.keyframes).filter(
          ([k]) => !layoutKeys.includes(k as KeyframeProperty),
        ),
      );
    return {
      type: "clip.update",
      timelineId: t.id,
      clipId: c.id,
      patch: {
        x: (left + width / 2 - 0.5) * t.width,
        y: (top + height / 2 - 0.5) * t.height,
        scale,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        fit: "cover",
        crop: { left: cropX, right: cropX, top: cropY, bottom: cropY },
        radius:
          layout === "full"
            ? 0
            : (options.radius ??
              (pip && (i > 0 || clips.length === 1) ? 24 : 0)),
        keyframes,
      },
    };
  });
}

export const cameraMoves = [
  "push-in",
  "pull-out",
  "slow-push",
  "fast-zoom",
  "zoom-punch",
  "pan-left",
  "pan-right",
  "tilt-up",
  "tilt-down",
  "ken-burns",
  "rotate-in",
  "shake",
] as const;
export type CameraMove = (typeof cameraMoves)[number];
export const cameraMoveNames: Record<CameraMove, string> = {
  "push-in": "推镜",
  "pull-out": "拉镜",
  "slow-push": "缓慢推近",
  "fast-zoom": "快速推近",
  "zoom-punch": "冲击放大",
  "pan-left": "左摇",
  "pan-right": "右摇",
  "tilt-up": "上摇",
  "tilt-down": "下摇",
  "ken-burns": "肯·伯恩斯",
  "rotate-in": "旋转进入",
  shake: "镜头晃动",
};
/**
 * Keyframes for a virtual camera move over clip-local frames [from, from +
 * length). Moves keep the frame covered: panning happens on a slightly
 * enlarged image. Intensity 1 is a natural move; 2 is twice as strong.
 */
export function cameraKeyframes(
  t: Pick<Timeline, "width" | "height" | "fps">,
  c: Pick<Clip, "duration" | "keyframes">,
  move: CameraMove,
  options: { intensity?: number; from?: number; length?: number } = {},
): Clip["keyframes"] {
  type Key = NonNullable<Clip["keyframes"]["x"]>[number];
  type Curve = Pick<Key, "easing" | "bezier">;
  const k = clamp(options.intensity ?? 1, 0.1, 4),
    from = clamp(Math.round(options.from ?? 0), 0, c.duration - 1),
    length = clamp(
      Math.round(options.length ?? c.duration - from),
      1,
      c.duration - from,
    ),
    end = from + length - 1,
    smooth: Curve = { easing: "bezier", bezier: [0.45, 0, 0.55, 1] },
    linear: Curve = { easing: "linear" },
    key = (frame: number, value: number, curve: Curve = smooth): Key => ({
      frame: clamp(Math.round(frame), 0, c.duration - 1),
      value,
      ...(curve.bezier ? curve : { easing: curve.easing }),
    }),
    span = (lo: number, hi: number, curve = smooth) => [
      key(from, lo, curve),
      key(end, hi, linear),
    ],
    zoom = 0.12 * k,
    // How far a scaled image can move before an edge shows.
    travel = (scale: number, size: number) => ((scale - 1) / 2) * size * 0.9;
  const out: Clip["keyframes"] = { ...c.keyframes };
  for (const p of ["x", "y", "scale", "rotation"] as const) delete out[p];
  switch (move) {
    case "push-in":
      out.scale = span(1, 1 + zoom);
      break;
    case "pull-out":
      out.scale = span(1 + zoom, 1);
      break;
    case "slow-push":
      out.scale = span(1, 1 + zoom / 2, linear);
      break;
    case "fast-zoom": {
      const quick = Math.min(length - 1, Math.round(t.fps * 0.35));
      out.scale = [
        key(from, 1, { easing: "bezier", bezier: [0.2, 0.8, 0.2, 1] }),
        key(from + quick, 1 + zoom * 2, linear),
      ];
      break;
    }
    case "zoom-punch": {
      const hit = Math.min(length - 1, 2),
        settle = Math.min(length - 1, Math.round(t.fps * 0.4));
      out.scale = [
        key(from, 1, linear),
        key(from + hit, 1 + zoom * 1.4, {
          easing: "bezier",
          bezier: [0.3, 0, 0.2, 1],
        }),
        key(from + settle, 1 + zoom, linear),
      ];
      break;
    }
    case "pan-left":
    case "pan-right": {
      const scale = 1 + zoom,
        d = travel(scale, t.width) * (move === "pan-left" ? 1 : -1);
      out.scale = [key(from, scale, linear)];
      out.x = span(-d, d);
      break;
    }
    case "tilt-up":
    case "tilt-down": {
      const scale = 1 + zoom,
        d = travel(scale, t.height) * (move === "tilt-up" ? 1 : -1);
      out.scale = [key(from, scale, linear)];
      out.y = span(-d, d);
      break;
    }
    case "ken-burns": {
      const scale = 1 + zoom * 1.5,
        dx = travel(scale, t.width) * 0.6,
        dy = travel(scale, t.height) * 0.6;
      out.scale = span(1 + zoom * 0.3, scale);
      out.x = span(dx, -dx);
      out.y = span(dy * 0.5, -dy * 0.5);
      break;
    }
    case "rotate-in":
      out.rotation = span(-4 * k, 0);
      out.scale = span(1 + zoom, 1.02);
      break;
    case "shake": {
      // Deterministic jitter from two incommensurate sines per axis.
      const step = Math.max(2, Math.round(t.fps / 12)),
        amplitude = 0.012 * k,
        x: Key[] = [],
        y: Key[] = [];
      for (let f = from; f <= end; f += step) {
        const s = f / t.fps;
        x.push(
          key(
            f,
            (Math.sin(s * 23.1) + Math.sin(s * 37.7) * 0.5) *
              amplitude *
              t.width,
          ),
        );
        y.push(
          key(
            f,
            (Math.sin(s * 29.3 + 1) + Math.sin(s * 41.9) * 0.5) *
              amplitude *
              t.height,
          ),
        );
      }
      out.scale = [key(from, 1 + amplitude * 4, linear)];
      out.x = x;
      out.y = y;
      break;
    }
  }
  for (const p of Object.keys(out) as KeyframeProperty[])
    out[p] = [...new Map(out[p]!.map((x) => [x.frame, x])).values()].sort(
      (a, b) => a.frame - b.frame,
    );
  return out;
}

/** Speech on the timeline as frame ranges: transcript words, else clips on dialogue and voice-over tracks. Close ranges are merged. */
export function speechRanges(
  p: Project,
  t: Timeline,
  mergeGap = 0.4,
): [number, number][] {
  const audible = new Set(t.tracks.filter((x) => !x.muted).map((x) => x.id)),
    ranges: [number, number][] = [];
  for (const transcript of p.transcripts)
    for (const w of wordsOnTimeline(transcript, t)) {
      const c = t.clips.find((x) => x.id === w.clipId);
      if (c && audible.has(c.trackId)) ranges.push([w.start, w.end]);
    }
  if (!ranges.length)
    for (const c of t.clips) {
      const track = t.tracks.find((x) => x.id === c.trackId);
      if (
        track &&
        !track.muted &&
        (track.role === "dialogue" || track.role === "voiceover")
      )
        ranges.push([c.start, clipEnd(c)]);
    }
  const gap = Math.round(mergeGap * t.fps);
  return mergeRanges(ranges.map(([a, b]) => [a - gap / 2, b + gap / 2])).map(
    ([a, b]) => [Math.max(0, Math.round(a + gap / 2)), Math.round(b - gap / 2)],
  );
}

/**
 * Volume keyframes that lower music while someone speaks. Depth is the
 * level under speech relative to the clip's own volume.
 */
export function duckingKeyframes(
  t: Timeline,
  c: Clip,
  speech: [number, number][],
  options: { depth?: number; attack?: number; release?: number } = {},
): NonNullable<Clip["keyframes"]["volume"]> {
  const depth = clamp(options.depth ?? 0.25, 0, 1),
    attack = Math.max(1, Math.round((options.attack ?? 0.25) * t.fps)),
    release = Math.max(1, Math.round((options.release ?? 0.5) * t.fps)),
    base = c.volume,
    low = base * depth,
    local = mergeRanges(
      speech
        .map(([a, b]): [number, number] => [
          Math.max(0, a - c.start - attack),
          Math.min(c.duration - 1, b - c.start + release),
        ])
        .filter(([a, b]) => b > a),
    ),
    keys: NonNullable<Clip["keyframes"]["volume"]> = [];
  for (const [a, b] of local) {
    const down = Math.min(b, a + attack),
      up = Math.max(down, b - release);
    keys.push(
      {
        frame: a,
        value: a === 0 && !keys.length ? low : base,
        easing: "ease-in-out",
      },
      { frame: down, value: low, easing: "linear" },
      { frame: up, value: low, easing: "ease-in-out" },
      { frame: b, value: base, easing: "linear" },
    );
  }
  return [...new Map(keys.map((k) => [k.frame, k])).values()].sort(
    (x, y) => x.frame - y.frame,
  );
}
/** Commands that duck every unlocked music clip under speech. */
export function duckMusic(
  p: Project,
  t: Timeline,
  options: {
    depth?: number;
    attack?: number;
    release?: number;
    clipIds?: string[];
  } = {},
): Command[] {
  const speech = speechRanges(p, t);
  if (!speech.length)
    throw new DomainError(
      "NO_SPEECH",
      "没有找到人声：请先转写对白，或把对白轨道的用途设为“对白”",
    );
  const music = t.clips.filter((c) => {
    if (options.clipIds) return options.clipIds.includes(c.id);
    const track = t.tracks.find((x) => x.id === c.trackId);
    return (
      track?.kind === "audio" &&
      !track.locked &&
      (track.role === "music" ||
        (!track.role && !p.transcripts.some((tr) => tr.assetId === c.assetId)))
    );
  });
  if (!music.length)
    throw new DomainError(
      "NO_MUSIC",
      "没有找到配乐：请把配乐轨道的用途设为“音乐”",
    );
  return music.flatMap((c): Command[] => {
    const volume = duckingKeyframes(t, c, speech, options);
    return volume.length
      ? [
          {
            type: "clip.update",
            timelineId: t.id,
            clipId: c.id,
            patch: { keyframes: { ...c.keyframes, volume } },
          },
        ]
      : [];
  });
}

/** Volume a clip plays at a clip-local frame, for meters and checks. */
export const clipVolumeAt = (c: Clip, frame: number) =>
  sampleProperty(c, "volume", frame);

const fillerTokens = new Set([
  "嗯",
  "呃",
  "额",
  "啊",
  "唔",
  "呣",
  "嗯嗯",
  "呃呃",
  "um",
  "umm",
  "uh",
  "uhh",
  "erm",
  "er",
  "ah",
  "hmm",
  "mm",
  "eh",
]);
const fillerPhrases = [
  ["那个"],
  ["就是说"],
  ["you", "know"],
  ["i", "mean"],
  ["sort", "of"],
  ["kind", "of"],
];
const normalized = (w: Word) =>
  w.text.toLowerCase().replace(/[\s,.!?;:，。！？；：、…"'“”‘’]+/g, "");
/**
 * Likely filler words: hesitation sounds, stutters (a word said twice in a
 * row) and common verbal fillers. Phrases are only suggestions, since they
 * also occur as real speech.
 */
export function fillerWords(transcript: Transcript) {
  const words = transcript.words.filter((w) => !w.deleted),
    found: {
      wordIds: string[];
      text: string;
      reason: "sound" | "repeat" | "phrase";
    }[] = [];
  for (let i = 0; i < words.length; i++) {
    const text = normalized(words[i]);
    if (!text) continue;
    if (fillerTokens.has(text)) {
      found.push({
        wordIds: [words[i].id],
        text: words[i].text,
        reason: "sound",
      });
      continue;
    }
    const next = words[i + 1];
    if (
      next &&
      normalized(next) === text &&
      text.length <= 12 &&
      !(cjk.test(text) && text.length < 2)
    ) {
      found.push({
        wordIds: [words[i].id],
        text: words[i].text,
        reason: "repeat",
      });
      continue;
    }
    for (const phrase of fillerPhrases) {
      const slice = words.slice(i, i + phrase.length);
      if (
        slice.length === phrase.length &&
        slice.every((w, k) => normalized(w) === phrase[k])
      ) {
        found.push({
          wordIds: slice.map((w) => w.id),
          text: slice.map((w) => w.text).join(" "),
          reason: "phrase",
        });
        break;
      }
    }
  }
  return found;
}

const cjk = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;
/** Transcript text with words joined the way they read, plus where each word sits in it. */
export function transcriptText(words: Word[]) {
  let text = "";
  const spans: { start: number; end: number }[] = [];
  words.forEach((w, i) => {
    const previous = words[i - 1];
    if (
      previous &&
      !(cjk.test(previous.text.slice(-1)) || cjk.test(w.text.slice(0, 1)))
    )
      text += " ";
    spans.push({ start: text.length, end: text.length + w.text.length });
    text += w.text;
  });
  return { text, spans };
}
export interface TranscriptMatch {
  /** Indexes into transcript.words of the first and last word touched. */
  first: number;
  last: number;
  wordIds: string[];
  text: string;
  start: number;
  end: number;
  /** Offsets of the match inside the first and last word. */
  head: number;
  tail: number;
}
/** Finds text across word boundaries; deleted words are skipped. */
export function findInTranscript(
  transcript: Transcript,
  query: string,
  options: { regex?: boolean; caseSensitive?: boolean } = {},
): TranscriptMatch[] {
  if (!query) return [];
  const indexes = transcript.words
      .map((w, i) => (w.deleted ? -1 : i))
      .filter((i) => i >= 0),
    words = indexes.map((i) => transcript.words[i]),
    { text, spans } = transcriptText(words);
  let pattern: RegExp;
  try {
    pattern = new RegExp(
      options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      options.caseSensitive ? "g" : "gi",
    );
  } catch {
    throw new DomainError("BAD_PATTERN", "查找表达式无效");
  }
  const out: TranscriptMatch[] = [];
  for (const m of text.matchAll(pattern)) {
    if (!m[0]) continue;
    const a = m.index!,
      b = a + m[0].length,
      covered = spans
        .map((s, k) => ({ ...s, k }))
        .filter((s) => s.end > a && s.start < b);
    if (!covered.length) continue;
    const first = covered[0],
      last = covered[covered.length - 1];
    out.push({
      first: indexes[first.k],
      last: indexes[last.k],
      wordIds: covered.map((s) => words[s.k].id),
      text: m[0],
      start: words[first.k].start,
      end: words[last.k].end,
      head: Math.max(0, a - first.start),
      tail: Math.max(0, last.end - b),
    });
    if (out.length >= 2000) break;
  }
  return out;
}
/**
 * Replaces matched text. A match inside one word changes that word; a match
 * across words becomes one word spanning their time, so the edit stays
 * aligned with the audio.
 */
export function replaceInTranscript(
  transcript: Transcript,
  query: string,
  replacement: string,
  options: { regex?: boolean; caseSensitive?: boolean } = {},
): { transcript: Transcript; count: number } {
  const matches = findInTranscript(transcript, query, options);
  if (!matches.length) return { transcript, count: 0 };
  const words = [...transcript.words];
  // From the end, so earlier indexes stay valid.
  let count = 0;
  for (const m of [...matches].reverse()) {
    if (words.slice(m.first, m.last + 1).some((w) => w.deleted)) continue;
    count++;
    const firstWord = words[m.first],
      lastWord = words[m.last],
      replaced = options.regex
        ? m.text.replace(
            new RegExp(query, options.caseSensitive ? "" : "i"),
            replacement,
          )
        : replacement;
    const text =
      firstWord.text.slice(0, m.head) +
      replaced +
      lastWord.text.slice(lastWord.text.length - m.tail);
    words.splice(m.first, m.last - m.first + 1, {
      ...firstWord,
      text,
      end: lastWord.end,
    });
  }
  return {
    transcript: {
      ...transcript,
      words: words.filter((w) => w.text.trim() || w.deleted),
    },
    count,
  };
}

/**
 * Packs clips into a nested sequence: they move to a new timeline and one
 * clip that plays it takes their place, so the group moves, grades and
 * transitions as one. The nested timeline keeps the clips' tracks.
 */
export function nestClips(
  t: Timeline,
  clipIds: string[],
  makeId: MakeId,
  now: string,
  name = "嵌套序列",
) {
  const chosen = t.clips.filter((c) => clipIds.includes(c.id));
  if (!chosen.length) throw new DomainError("NOT_FOUND", "请选择片段");
  chosen.forEach((c) => assertUnlocked(t, c.trackId));
  const begin = Math.min(...chosen.map((c) => c.start)),
    end = Math.max(...chosen.map(clipEnd)),
    nestedId = makeId(),
    trackMap = new Map<string, string>();
  for (const c of chosen)
    if (!trackMap.has(c.trackId)) trackMap.set(c.trackId, makeId());
  const nested = timelineSchema.parse({
    ...makeTimeline(nestedId, name, t.fps, t.width, t.height),
    tracks: t.tracks
      .filter((x) => trackMap.has(x.id))
      .map((x) => ({ ...x, id: trackMap.get(x.id)!, locked: false })),
    clips: chosen.map(({ shotId: _s, linkId: _l, groupId: _g, ...c }) => ({
      ...c,
      id: makeId(),
      trackId: trackMap.get(c.trackId)!,
      start: c.start - begin,
    })),
  });
  const asset = assetSchema.parse({
    id: makeId(),
    name,
    kind: "sequence",
    sequenceTimelineId: nestedId,
    duration: (end - begin) / t.fps,
    folder: "嵌套序列",
    color: "#7b9fb8",
    createdAt: now,
  });
  // The nested clip sits on the highest visual track the clips used.
  const visual =
    t.tracks.find(
      (x) => trackMap.has(x.id) && (x.kind === "video" || x.kind === "motion"),
    ) ?? t.tracks.find((x) => x.kind === "video" && !x.locked);
  if (!visual) throw new DomainError("TRACK", "需要一条画面轨道放置嵌套序列");
  const clip = clipSchema.parse({
    id: makeId(),
    assetId: asset.id,
    trackId: visual.id,
    start: begin,
    duration: end - begin,
    name,
  });
  const commands: Command[] = [
    { type: "timeline.create", timeline: nested },
    { type: "timeline.activate", timelineId: t.id },
    { type: "asset.add", asset },
    ...chosen.map(
      (c): Command => ({
        type: "clip.remove",
        timelineId: t.id,
        clipId: c.id,
        ripple: false,
      }),
    ),
    { type: "clip.add", timelineId: t.id, clip },
  ];
  return { commands, clipId: clip.id, timelineId: nestedId, assetId: asset.id };
}

/**
 * A new timeline made of these frame ranges of `t`, in order and back to
 * back, with the material of every track inside them, as for a highlight
 * reel. The source timeline is not changed.
 */
export function rangesTimeline(
  t: Timeline,
  ranges: [number, number][],
  makeId: MakeId,
  name: string,
): Timeline {
  const trackIds = new Map(t.tracks.map((x) => [x.id, makeId()])),
    clips: Clip[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (b <= a) continue;
    for (const c of t.clips) {
      const from = Math.max(c.start, a),
        to = Math.min(clipEnd(c), b);
      if (to <= from) continue;
      const {
        shotId: _shot,
        linkId: _link,
        groupId: _group,
        ...piece
      } = sliceClip(c, t.fps, from - c.start, to - from, makeId());
      clips.push({
        ...piece,
        trackId: trackIds.get(c.trackId)!,
        start: at + from - a,
      });
    }
    at += b - a;
  }
  if (!clips.length)
    throw new DomainError("EMPTY_RANGES", "所选范围里没有片段");
  return timelineSchema.parse({
    ...makeTimeline(makeId(), name, t.fps, t.width, t.height),
    background: t.background,
    ...(t.watermark ? { watermark: t.watermark } : {}),
    tracks: t.tracks.map((x) => ({
      ...x,
      id: trackIds.get(x.id)!,
      locked: false,
    })),
    clips,
  });
}
