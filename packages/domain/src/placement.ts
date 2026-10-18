import type { Command } from "./commands";
import { DomainError } from "./engine";
import {
  clipSchema,
  isLutAsset,
  placementIssue,
  trackKindFor,
  trackSchema,
  type Asset,
  type Clip,
  type Project,
  type Timeline,
  type Track,
} from "./model";

export interface Span {
  start: number;
  duration: number;
}
/** True when the span intersects a clip on the track, ignoring the given clips. */
export const collides = (
  clips: Clip[],
  trackId: string,
  span: Span,
  ignore: ReadonlySet<string> = new Set(),
) =>
  clips.some(
    (c) =>
      c.trackId === trackId &&
      !ignore.has(c.id) &&
      c.start < span.start + span.duration &&
      span.start < c.start + c.duration,
  );
/** The track kind used when the preferred track is busy: the preferred track's own kind when the asset fits it. */
const fallbackKind = (
  t: Timeline,
  asset: Pick<Asset, "kind" | "name">,
  preferredTrackId?: string,
) => {
  const preferred = t.tracks.find((x) => x.id === preferredTrackId);
  return preferred && !placementIssue(preferred.kind, asset)
    ? preferred.kind
    : trackKindFor(asset.kind);
};
/** The preferred track when it has room; otherwise the nearest unlocked track of the fallback kind, preferring the layer above. */
export function freeTrack(
  t: Timeline,
  asset: Pick<Asset, "kind" | "name">,
  span: Span,
  preferredTrackId?: string,
): Track | undefined {
  const usable = (track: Track) =>
      !track.locked &&
      !placementIssue(track.kind, asset) &&
      !collides(t.clips, track.id, span),
    preferred = t.tracks.findIndex((x) => x.id === preferredTrackId);
  if (preferred >= 0 && usable(t.tracks[preferred])) return t.tracks[preferred];
  const origin = Math.max(0, preferred),
    kind = fallbackKind(t, asset, preferredTrackId);
  return t.tracks
    .map((track, index) => ({
      track,
      distance: Math.abs(index - origin) + (index < origin ? 0.5 : 0),
    }))
    .filter(({ track }) => track.kind === kind && usable(track))
    .sort((a, b) => a.distance - b.distance)[0]?.track;
}
const trackNames = {
  video: "画面",
  audio: "音频",
  text: "字幕",
  motion: "动效",
};
export const newTrack = (t: Timeline, kind: Track["kind"], id: string) =>
  trackSchema.parse({
    id,
    kind,
    name: `${trackNames[kind]} ${String(t.tracks.filter((x) => x.kind === kind).length + 1).padStart(2, "0")}`,
    ...(kind === "audio"
      ? { color: "#ac9166" }
      : kind === "text"
        ? { color: "#ae96c7" }
        : {}),
  });
/** Each clip keeps its own track (clip.trackId) when that span is free there, else takes a free track of the same kind, else a new track. */
function place(
  t: Timeline,
  drafts: { clip: Clip; asset: Asset }[],
  makeId: () => string,
) {
  const working: Timeline = {
      ...t,
      tracks: [...t.tracks],
      clips: [...t.clips],
    },
    commands: Command[] = [];
  for (const { clip, asset } of drafts) {
    if (isLutAsset(asset))
      throw new DomainError("TRACK_KIND", placementIssue("video", asset)!);
    let track = freeTrack(working, asset, clip, clip.trackId);
    if (!track) {
      track = newTrack(
        working,
        fallbackKind(working, asset, clip.trackId),
        makeId(),
      );
      working.tracks.push(track);
      commands.push({ type: "track.add", timelineId: t.id, track });
    }
    const placed = clipSchema.parse({ ...clip, trackId: track.id });
    working.clips.push(placed);
    commands.push({ type: "clip.add", timelineId: t.id, clip: placed });
  }
  return commands;
}
/** Commands that put an asset at a frame without covering other clips. */
export function placeAsset(
  p: Project,
  t: Timeline,
  asset: Asset,
  at: number,
  makeId: () => string,
  preferredTrackId?: string,
) {
  const clip = clipSchema.parse({
    id: makeId(),
    assetId: asset.id,
    trackId: preferredTrackId ?? "unplaced",
    start: Math.max(0, Math.round(at)),
    duration: Math.max(1, Math.round((asset.duration || 5) * t.fps)),
    name: asset.name,
    text: asset.text,
  });
  return {
    clip,
    commands: [
      ...(p.assets.some((a) => a.id === asset.id)
        ? []
        : [{ type: "asset.add" as const, asset }]),
      ...place(t, [{ clip, asset }], makeId),
    ],
  };
}
export interface ClipboardContent {
  clips: Clip[];
  /** Assets the clips and their LUT effects use, so another project can receive them. */
  assets: Asset[];
}
/** Pastes clips with their relative timing from a frame. Shot bindings stay with the originals; groups shared by pasted clips get new IDs. */
export function pasteClips(
  p: Project,
  t: Timeline,
  content: ClipboardContent,
  at: number,
  makeId: () => string,
) {
  const order = new Map(t.tracks.map((x, i) => [x.id, i])),
    clips = [...content.clips].sort(
      (a, b) =>
        a.start - b.start ||
        (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0),
    );
  if (!clips.length) return { commands: [], clipIds: [], end: at };
  const base = Math.min(...clips.map((c) => c.start)),
    origin = Math.max(0, Math.round(at)),
    commands: Command[] = [],
    known = new Set(p.assets.map((a) => a.id));
  for (const asset of content.assets)
    if (!known.has(asset.id)) {
      known.add(asset.id);
      commands.push({ type: "asset.add", asset });
    }
  const members = new Map<string, number>(),
    groups = new Map<string, string>();
  for (const c of clips)
    if (c.groupId) members.set(c.groupId, (members.get(c.groupId) ?? 0) + 1);
  const drafts = clips.map(({ shotId: _shot, groupId, ...source }) => {
    const asset =
      content.assets.find((a) => a.id === source.assetId) ??
      p.assets.find((a) => a.id === source.assetId);
    if (!asset) throw new DomainError("NOT_FOUND", "素材不存在");
    if (groupId && members.get(groupId)! > 1 && !groups.has(groupId))
      groups.set(groupId, makeId());
    return {
      asset,
      clip: clipSchema.parse({
        ...source,
        id: makeId(),
        start: origin + source.start - base,
        ...(groupId && groups.has(groupId)
          ? { groupId: groups.get(groupId) }
          : {}),
      }),
    };
  });
  commands.push(...place(t, drafts, makeId));
  return {
    commands,
    clipIds: drafts.map((d) => d.clip.id),
    end: Math.max(...drafts.map((d) => d.clip.start + d.clip.duration)),
  };
}
export interface ClipMove {
  clipId: string;
  start: number;
  trackId: string;
}
/** Shifts clips together by frames and track rows; any blocked clip blocks the whole move. A "track" reason means the rows do not fit, "position" that the time span is taken. */
export function moveClips(
  p: Project,
  t: Timeline,
  ids: string[],
  shift: number,
  rows: number,
): { moves: ClipMove[] } | { error: string; reason: "track" | "position" } {
  const ignore = new Set(ids),
    moves: ClipMove[] = [];
  for (const c of t.clips.filter((c) => ignore.has(c.id))) {
    const track =
        t.tracks[t.tracks.findIndex((x) => x.id === c.trackId) + rows],
      asset = p.assets.find((a) => a.id === c.assetId);
    if (!track || !asset)
      return { error: "没有可以放置的轨道", reason: "track" };
    if (track.locked) return { error: "目标轨道已锁定", reason: "track" };
    const issue = placementIssue(track.kind, asset);
    if (issue) return { error: issue, reason: "track" };
    const start = c.start + shift;
    if (start < 0)
      return { error: "片段不能早于时间线开头", reason: "position" };
    if (collides(t.clips, track.id, { start, duration: c.duration }, ignore))
      return { error: "目标位置已有片段", reason: "position" };
    moves.push({ clipId: c.id, start, trackId: track.id });
  }
  return { moves };
}
/** Video and audio clips play a source range; stills, text and animations can be stretched freely. */
export const hasSourceRange = (asset: Pick<Asset, "kind">) =>
  asset.kind === "video" || asset.kind === "audio";
/** How far a clip's edges can move: not across neighbors on its track and, for video and audio, not outside the source media. */
export function trimBounds(
  t: Timeline,
  clip: Clip,
  asset: Pick<Asset, "kind" | "duration">,
) {
  const end = clip.start + clip.duration,
    others = t.clips.filter(
      (c) => c.trackId === clip.trackId && c.id !== clip.id,
    ),
    before = Math.max(
      0,
      ...others
        .filter((c) => c.start + c.duration <= clip.start)
        .map((c) => c.start + c.duration),
    ),
    after = Math.min(
      Infinity,
      ...others.filter((c) => c.start >= end).map((c) => c.start),
    ),
    source = hasSourceRange(asset),
    sourceStart = source
      ? clip.start - Math.floor((clip.sourceOffset / clip.speed) * t.fps)
      : -Infinity,
    sourceEnd =
      source && asset.duration
        ? clip.start +
          Math.floor(
            ((asset.duration - clip.sourceOffset) / clip.speed) * t.fps,
          )
        : Infinity;
  // Clips that already exceed a bound can still shrink; they just cannot grow further.
  return {
    minStart: Math.min(clip.start, Math.max(before, sourceStart)),
    maxEnd: Math.max(end, Math.min(after, sourceEnd)),
  };
}
/** Frames where clips begin or end, plus the start of the timeline, in order. */
export const editPoints = (t: Timeline) =>
  [
    ...new Set([0, ...t.clips.flatMap((c) => [c.start, c.start + c.duration])]),
  ].sort((a, b) => a - b);
/** The marked span clipped to the timeline: `start` is the first frame, `end` the frame after the last; null when nothing usable is marked. */
export function markedSpan(
  t: Timeline,
  marks: { in?: number; out?: number } | undefined,
) {
  if (marks?.in === undefined && marks?.out === undefined) return null;
  const length = Math.max(1, ...t.clips.map((c) => c.start + c.duration)),
    start = Math.max(0, marks.in ?? 0),
    end = Math.min(length, marks.out ?? length);
  return end > start ? { start, end } : null;
}
