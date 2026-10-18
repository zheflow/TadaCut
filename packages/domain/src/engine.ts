import {
  commandSchema,
  transactionSchema,
  type Command,
  type Transaction,
} from "./commands";
import { sliceKeyframes } from "./animation";
import { effectParams } from "./effects";
import {
  clipSchema,
  placementIssue,
  projectSchema,
  type Clip,
  type Project,
  type Shot,
  type Timeline,
} from "./model";

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
const requireValue = <T>(value: T | undefined, name: string): T => {
  if (!value) throw new DomainError("NOT_FOUND", `${name}不存在`);
  return value;
};
const timeline = (p: Project, tid: string) =>
  requireValue(
    p.timelines.find((t) => t.id === tid),
    "时间线",
  );
const clip = (t: Timeline, cid: string) =>
  requireValue(
    t.clips.find((c) => c.id === cid),
    "片段",
  );
const unique = <T extends { id: string }>(
  values: T[],
  item: T,
  label: string,
) => {
  if (values.some((v) => v.id === item.id))
    throw new DomainError("DUPLICATE_ID", `${label} ID 重复`);
  values.push(item);
};
const replace = <T extends { id: string }>(values: T[], item: T) => {
  const index = values.findIndex((v) => v.id === item.id);
  if (index < 0) values.push(item);
  else values[index] = item;
};
/** Missing references are reported by validateProject; this rejects mismatched kinds. */
const assertPlacement = (p: Project, t: Timeline, c: Clip) => {
  const track = t.tracks.find((x) => x.id === c.trackId),
    asset = p.assets.find((a) => a.id === c.assetId),
    issue = track && asset && placementIssue(track.kind, asset);
  if (issue) throw new DomainError("TRACK_KIND", issue);
};
export const shotFingerprint = (s: Shot) =>
  JSON.stringify([
    s.id,
    s.assetId ?? null,
    s.duration,
    s.dialogue,
    s.title,
    s.description,
  ]);
const clipFingerprint = (c: Clip, t: Timeline) =>
  JSON.stringify([c.assetId, c.duration / t.fps, c.start]);
const syncBaseline = (s: Shot, c: Clip, t: Timeline) =>
  JSON.stringify({ story: shotFingerprint(s), clip: clipFingerprint(c, t) });
export function storySyncConflicts(
  p: Project,
  t: Timeline,
): { shotId: string; title: string; reason: string }[] {
  return p.story.shots.flatMap((s) => {
    const c = t.clips.find((c) => c.shotId === s.id);
    if (!c || !s.syncBaseline) return [];
    let baseline: { story: string; clip: string };
    try {
      baseline = JSON.parse(s.syncBaseline);
    } catch {
      return [];
    }
    if (!baseline.story || !baseline.clip) return [];
    return clipFingerprint(c, t) !== baseline.clip &&
      shotFingerprint(s) !== baseline.story
      ? [{ shotId: s.id, title: s.title, reason: "分镜和剪辑都已改变" }]
      : [];
  });
}
function syncStory(
  p: Project,
  command: Extract<Command, { type: "story.sync" }>,
) {
  const t = timeline(p, command.timelineId);
  const targetTrack = requireValue(
    t.tracks.find((t) => t.id === command.trackId),
    "目标轨道",
  );
  if (targetTrack.locked)
    throw new DomainError("TRACK_LOCKED", "请先解锁同步轨道");
  const conflicts = storySyncConflicts(p, t);
  if (conflicts.length && !command.force)
    throw new DomainError(
      "SYNC_CONFLICT",
      "两侧都已修改，请选择同步方向后确认",
      conflicts,
    );
  if (command.direction === "timeline-to-story") {
    const shotClips = t.clips
      .filter((c) => c.shotId)
      .sort((a, b) => a.start - b.start);
    for (const [index, c] of shotClips.entries()) {
      const s = p.story.shots.find((s) => s.id === c.shotId);
      if (!s) continue;
      s.number = index + 1;
      s.assetId = c.assetId;
      s.duration = c.duration / t.fps;
      s.syncBaseline = syncBaseline(s, c, t);
    }
  } else {
    const { kept, placed, blocked } = layoutStory(p, t, command.trackId);
    if (blocked)
      throw new DomainError(
        "STORY_OVERLAP",
        `分镜序列会覆盖「${blocked.name || "已有片段"}」，请换一条轨道或先移开它`,
      );
    t.clips = kept;
    for (const { shot, clip } of placed) {
      assertPlacement(p, t, clip);
      t.clips.push(clip);
      shot.syncBaseline = syncBaseline(shot, clip, t);
    }
  }
}
/**
 * Where story-to-timeline sync puts the bound shots on a track. The sequence
 * starts where its clips already are, otherwise after the track's other clips;
 * `blocked` is a remaining clip on that track the sequence would cover.
 */
export function layoutStory(p: Project, t: Timeline, trackId: string) {
  const existing = new Map(
      t.clips.filter((c) => c.shotId).map((c) => [c.shotId!, c]),
    ),
    laid = new Set(p.story.shots.filter((s) => s.assetId).map((s) => s.id));
  // A laid-out shot moves to the target track even if its clip sits elsewhere,
  // so its previous clip ID can be reused without a duplicate.
  const kept = t.clips.filter(
      (c) => !c.shotId || (c.trackId !== trackId && !laid.has(c.shotId)),
    ),
    previous = t.clips.filter((c) => c.shotId && laid.has(c.shotId));
  let start = previous.length
    ? Math.min(...previous.map((c) => c.start))
    : Math.max(
        0,
        ...kept
          .filter((c) => c.trackId === trackId)
          .map((c) => c.start + c.duration),
      );
  const placed: { shot: Shot; clip: Clip }[] = [];
  for (const s of [...p.story.shots].sort((a, b) => a.number - b.number)) {
    if (!s.assetId) continue;
    requireValue(
      p.assets.find((a) => a.id === s.assetId),
      "分镜素材",
    );
    const before = existing.get(s.id),
      duration = Math.max(1, Math.round(s.duration * t.fps));
    const clip = clipSchema.parse({
      ...before,
      id: before?.id ?? `shot-clip-${t.id}-${s.id}`,
      assetId: s.assetId,
      trackId,
      start,
      duration,
      name: s.title,
      shotId: s.id,
      keyframes: before ? sliceKeyframes(before, 0, duration) : {},
    });
    placed.push({ shot: s, clip });
    start += duration;
  }
  const blocked = kept.find(
    (c) =>
      c.trackId === trackId &&
      placed.some(
        ({ clip }) =>
          clip.start < c.start + c.duration &&
          c.start < clip.start + clip.duration,
      ),
  );
  return { kept, placed, blocked };
}
/**
 * Removes source time ranges (seconds) of an asset from every clip that plays
 * it, closing the gaps on each clip's track.
 */
function cutSource(t: Timeline, assetId: string, ranges: [number, number][]) {
  const next: Clip[] = [];
  const removedByTrack = new Map<string, number>();
  for (const c of [...t.clips].sort((a, b) => a.start - b.start)) {
    const shift = removedByTrack.get(c.trackId) ?? 0;
    if (c.assetId !== assetId) {
      next.push({ ...c, start: Math.max(0, c.start - shift) });
      continue;
    }
    if (t.tracks.find((tr) => tr.id === c.trackId)?.locked)
      throw new DomainError("TRACK_LOCKED", "请先解锁文稿对应轨道");
    const begin = c.sourceOffset,
      end = begin + (c.duration / t.fps) * c.speed;
    const cuts = ranges
      .map(([a, b]) => [Math.max(begin, a), Math.min(end, b)])
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    if (!cuts.length) {
      next.push({ ...c, start: Math.max(0, c.start - shift) });
      continue;
    }
    const kept: [number, number][] = [];
    let cursor = begin;
    for (const [a, b] of cuts) {
      if (a > cursor) kept.push([cursor, a]);
      cursor = Math.max(cursor, b);
    }
    if (cursor < end) kept.push([cursor, end]);
    let destination = c.start - shift,
      count = 0;
    for (const [a, b] of kept) {
      const duration = Math.round(((b - a) / c.speed) * t.fps);
      if (duration < 1) continue;
      next.push({
        ...c,
        id: `${c.id}-cut-${count++}`,
        start: Math.max(0, destination),
        duration,
        sourceOffset: a,
        keyframes: sliceKeyframes(
          c,
          Math.round(((a - begin) / c.speed) * t.fps),
          duration,
        ),
      });
      destination += duration;
    }
    removedByTrack.set(
      c.trackId,
      shift + c.duration - (destination - (c.start - shift)),
    );
  }
  t.clips = next;
}
function cutTranscript(
  p: Project,
  command: Extract<Command, { type: "transcript.cut" }>,
) {
  const transcript = requireValue(
    p.transcripts.find((t) => t.id === command.transcriptId),
    "文稿",
  );
  const ids = new Set(command.wordIds);
  const words = transcript.words.filter((w) => ids.has(w.id) && !w.deleted);
  if (!words.length) throw new DomainError("EMPTY_CUT", "没有可删除的词");
  cutSource(
    timeline(p, command.timelineId),
    transcript.assetId,
    words.map((w) => [w.start, w.end]),
  );
  transcript.words = transcript.words.map((w) =>
    ids.has(w.id) ? { ...w, deleted: true } : w,
  );
}
/** The source ranges that shorten pauses between kept words to maxGap seconds. */
export function pauseRanges(
  words: { start: number; end: number; deleted?: boolean }[],
  maxGap: number,
) {
  const kept = words
    .filter((w) => !w.deleted)
    .sort((a, b) => a.start - b.start);
  const ranges: [number, number][] = [];
  for (let i = 1; i < kept.length; i++) {
    const gap = kept[i].start - kept[i - 1].end;
    if (gap > maxGap)
      ranges.push([kept[i - 1].end + maxGap / 2, kept[i].start - maxGap / 2]);
  }
  return ranges;
}
function compressPauses(
  p: Project,
  command: Extract<Command, { type: "transcript.gaps" }>,
) {
  const transcript = requireValue(
    p.transcripts.find((t) => t.id === command.transcriptId),
    "文稿",
  );
  const ranges = pauseRanges(transcript.words, command.maxGap);
  if (!ranges.length)
    throw new DomainError("EMPTY_CUT", "没有超过设定长度的停顿");
  cutSource(timeline(p, command.timelineId), transcript.assetId, ranges);
}
/** Splits caption word timing at a clip-local frame. */
function sliceWords(c: Clip, start: number, duration: number) {
  if (!c.caption?.words) return c.caption;
  return {
    ...c.caption,
    words: c.caption.words
      .filter((w) => w.end > start && w.start < start + duration)
      .map((w) => ({
        ...w,
        start: Math.max(0, w.start - start),
        end: Math.min(duration, w.end - start),
      })),
  };
}
/** Which timelines a sequence asset plays, for cycle checks. */
function nestedTimelines(p: Project, t: Timeline) {
  return t.clips
    .map((c) => p.assets.find((a) => a.id === c.assetId))
    .filter((a) => a?.kind === "sequence" && a.sequenceTimelineId)
    .map((a) => a!.sequenceTimelineId!);
}
function apply(p: Project, c: Command, now: string) {
  if (c.type === "clip.keyframe" || c.type === "clip.keyframe.remove") {
    const t = timeline(p, c.timelineId),
      item = clip(t, c.clipId);
    if (t.tracks.find((tr) => tr.id === item.trackId)?.locked)
      throw new DomainError("TRACK_LOCKED", "请先解锁轨道");
  }
  if (c.type === "clip.group") {
    const t = timeline(p, c.timelineId);
    if (
      c.clipIds.some(
        (id) => t.tracks.find((tr) => tr.id === clip(t, id).trackId)?.locked,
      )
    )
      throw new DomainError("TRACK_LOCKED", "请先解锁轨道");
  }
  switch (c.type) {
    case "project.rename":
      p.name = c.name;
      break;
    case "project.archive":
      p.archived = c.archived;
      break;
    case "asset.add":
      unique(p.assets, c.asset, "素材");
      break;
    case "asset.update":
      Object.assign(
        requireValue(
          p.assets.find((a) => a.id === c.assetId),
          "素材",
        ),
        c.patch,
      );
      break;
    case "asset.remove":
      if (
        p.timelines.some((t) =>
          t.clips.some(
            (c2) =>
              c2.assetId === c.assetId || c2.effects.lutAssetId === c.assetId,
          ),
        )
      )
        throw new DomainError("ASSET_IN_USE", "该素材仍被时间线使用");
      p.assets = p.assets.filter((a) => a.id !== c.assetId);
      p.story.shots.forEach((s) => {
        if (s.assetId === c.assetId) delete s.assetId;
      });
      p.story.entities.forEach(
        (e) =>
          (e.referenceAssetIds = e.referenceAssetIds.filter(
            (x) => x !== c.assetId,
          )),
      );
      p.transcripts = p.transcripts.filter((x) => x.assetId !== c.assetId);
      p.story.entities.forEach((e) => {
        e.candidateAssetIds = e.candidateAssetIds.filter(
          (x) => x !== c.assetId,
        );
        for (const view of ["front", "side", "back"] as const)
          if (e.views[view] === c.assetId) delete e.views[view];
      });
      p.story.shots.forEach((s) => {
        for (const key of [
          "frameAssetId",
          "videoAssetId",
          "voiceAssetId",
        ] as const)
          if (s[key] === c.assetId) delete s[key];
        s.production.history = s.production.history.filter(
          (h) => h.assetId !== c.assetId,
        );
      });
      if (p.styles.brand.logoAssetId === c.assetId)
        delete p.styles.brand.logoAssetId;
      if (p.story.development.sourceAssetId === c.assetId)
        delete p.story.development.sourceAssetId;
      p.timelines.forEach((t) => {
        if (t.watermark?.assetId === c.assetId) {
          delete t.watermark.assetId;
          if (!t.watermark.text) delete t.watermark;
        }
      });
      break;
    case "timeline.create":
      unique(p.timelines, c.timeline, "时间线");
      p.activeTimelineId = c.timeline.id;
      break;
    case "timeline.activate":
      timeline(p, c.timelineId);
      p.activeTimelineId = c.timelineId;
      break;
    case "timeline.rename":
      timeline(p, c.timelineId).name = c.name;
      break;
    case "timeline.remove": {
      if (p.timelines.length === 1)
        throw new DomainError("LAST_TIMELINE", "至少保留一个时间线");
      const nested = p.assets.filter(
        (a) => a.kind === "sequence" && a.sequenceTimelineId === c.timelineId,
      );
      if (
        nested.some((a) =>
          p.timelines.some((t) => t.clips.some((x) => x.assetId === a.id)),
        )
      )
        throw new DomainError(
          "SEQUENCE_IN_USE",
          "该时间线作为嵌套序列仍在使用，请先移除对应片段",
        );
      p.assets = p.assets.filter((a) => !nested.includes(a));
      p.timelines = p.timelines.filter((t) => t.id !== c.timelineId);
      if (p.activeTimelineId === c.timelineId)
        p.activeTimelineId = p.timelines[0].id;
      break;
    }
    case "timeline.resize":
      Object.assign(timeline(p, c.timelineId), {
        width: c.width,
        height: c.height,
      });
      break;
    case "track.add":
      unique(timeline(p, c.timelineId).tracks, c.track, "轨道");
      break;
    case "track.update":
      Object.assign(
        requireValue(
          timeline(p, c.timelineId).tracks.find((t) => t.id === c.trackId),
          "轨道",
        ),
        c.patch,
      );
      break;
    case "track.remove": {
      const t = timeline(p, c.timelineId);
      t.tracks = t.tracks.filter((x) => x.id !== c.trackId);
      t.clips = t.clips.filter((x) => x.trackId !== c.trackId);
      break;
    }
    case "track.reorder": {
      const t = timeline(p, c.timelineId);
      if (
        new Set(c.ids).size !== t.tracks.length ||
        c.ids.some((id2) => !t.tracks.some((x) => x.id === id2))
      )
        throw new DomainError("TRACK_ORDER", "轨道排序需要所有轨道且不能重复");
      t.tracks = c.ids.map((id2) => t.tracks.find((x) => x.id === id2)!);
      break;
    }
    case "clip.add": {
      const t = timeline(p, c.timelineId);
      if (t.tracks.find((tr) => tr.id === c.clip.trackId)?.locked)
        throw new DomainError("TRACK_LOCKED", "目标轨道已锁定");
      assertPlacement(p, t, c.clip);
      unique(t.clips, c.clip, "片段");
      break;
    }
    case "clip.update": {
      const t = timeline(p, c.timelineId),
        item = clip(t, c.clipId);
      if (t.tracks.find((t2) => t2.id === item.trackId)?.locked)
        throw new DomainError("TRACK_LOCKED", "请先解锁轨道");
      if (
        c.patch.trackId &&
        t.tracks.find((tr) => tr.id === c.patch.trackId)?.locked
      )
        throw new DomainError("TRACK_LOCKED", "目标轨道已锁定");
      Object.assign(item, c.patch);
      if (c.patch.trackId !== undefined || c.patch.assetId !== undefined)
        assertPlacement(p, t, item);
      break;
    }
    case "clip.remove": {
      const t = timeline(p, c.timelineId),
        item = clip(t, c.clipId);
      if (t.tracks.find((t2) => t2.id === item.trackId)?.locked)
        throw new DomainError("TRACK_LOCKED", "请先解锁轨道");
      t.clips = t.clips.filter((x) => x.id !== c.clipId);
      if (c.ripple)
        t.clips.forEach((x) => {
          if (
            x.trackId === item.trackId &&
            x.start >= item.start + item.duration
          )
            x.start -= item.duration;
        });
      break;
    }
    case "clip.split": {
      const t = timeline(p, c.timelineId),
        item = clip(t, c.clipId);
      if (c.at <= item.start || c.at >= item.start + item.duration)
        throw new DomainError("SPLIT_OUTSIDE", "播放头必须在片段内部");
      if (t.tracks.find((t2) => t2.id === item.trackId)?.locked)
        throw new DomainError("TRACK_LOCKED", "请先解锁轨道");
      const delta = c.at - item.start;
      unique(
        t.clips,
        {
          ...structuredClone(item),
          id: c.newClipId,
          start: c.at,
          duration: item.duration - delta,
          sourceOffset: item.sourceOffset + (delta / t.fps) * item.speed,
          keyframes: sliceKeyframes(item, delta, item.duration - delta),
          ...(item.caption
            ? { caption: sliceWords(item, delta, item.duration - delta) }
            : {}),
        },
        "片段",
      );
      item.keyframes = sliceKeyframes(item, 0, delta);
      if (item.caption) item.caption = sliceWords(item, 0, delta);
      item.duration = delta;
      // The outgoing transition stays with the right half, at the original cut.
      delete item.transition;
      break;
    }
    case "clip.keyframe": {
      const item = clip(timeline(p, c.timelineId), c.clipId);
      if (c.keyframe.frame >= item.duration)
        throw new DomainError("KEYFRAME_OUTSIDE", "关键帧超出片段");
      item.keyframes[c.property] = [
        ...(item.keyframes[c.property] ?? []).filter(
          (x) => x.frame !== c.keyframe.frame,
        ),
        c.keyframe,
      ].sort((a, b) => a.frame - b.frame);
      break;
    }
    case "clip.keyframe.remove": {
      const item = clip(timeline(p, c.timelineId), c.clipId);
      item.keyframes[c.property] = (item.keyframes[c.property] ?? []).filter(
        (x) => x.frame !== c.frame,
      );
      break;
    }
    case "clip.group": {
      const t = timeline(p, c.timelineId);
      c.clipIds.forEach((cid) => {
        const item = clip(t, cid);
        if (c.groupId) item.groupId = c.groupId;
        else delete item.groupId;
      });
      break;
    }
    case "story.entity.upsert":
      replace(p.story.entities, c.entity);
      break;
    case "story.entity.remove":
      p.story.entities = p.story.entities.filter((e) => e.id !== c.entityId);
      p.story.shots.forEach(
        (s) => (s.entityIds = s.entityIds.filter((x) => x !== c.entityId)),
      );
      break;
    case "story.shot.upsert":
      replace(p.story.shots, c.shot);
      break;
    case "story.shot.remove":
      p.story.shots = p.story.shots.filter((s) => s.id !== c.shotId);
      p.timelines.forEach((t) =>
        t.clips.forEach((clip) => {
          if (clip.shotId === c.shotId) delete clip.shotId;
        }),
      );
      break;
    case "story.logline":
      p.story.logline = c.logline;
      if (c.title) p.story.title = c.title;
      break;
    case "story.sync":
      syncStory(p, c);
      break;
    case "transcript.set":
      replace(p.transcripts, c.transcript);
      break;
    case "transcript.cut":
      cutTranscript(p, c);
      break;
    case "transcript.speaker":
      requireValue(
        p.transcripts.find((t) => t.id === c.transcriptId),
        "文稿",
      ).words.forEach((w) => {
        if (w.speaker === c.from) w.speaker = c.to;
      });
      break;
    case "canvas.upsert":
      replace(p.canvas, c.node);
      break;
    case "canvas.remove":
      p.canvas = p.canvas.filter((n) => n.id !== c.nodeId);
      break;
    case "memory.upsert":
      replace(p.memories, c.memory);
      break;
    case "marker.add":
      unique(timeline(p, c.timelineId).markers, c.marker, "标记");
      break;
    case "memory.remove":
      p.memories = p.memories.filter((m) => m.id !== c.memoryId);
      break;
    case "multicam.create": {
      const t = timeline(p, c.timelineId);
      unique(t.multicam, c.group, "机位组");
      c.group.cameraClipIds.forEach((id) => {
        clip(t, id).groupId = c.group.id;
      });
      break;
    }
    case "multicam.switch": {
      const t = timeline(p, c.timelineId),
        group = requireValue(
          t.multicam.find((g) => g.id === c.groupId),
          "机位组",
        );
      if (!group.cameraClipIds.includes(c.clipId))
        throw new DomainError("CAMERA_NOT_FOUND", "机位不在同步组中");
      group.switches = [
        ...group.switches.filter((s) => s.frame !== c.frame),
        { frame: c.frame, clipId: c.clipId },
      ].sort((a, b) => a.frame - b.frame);
      break;
    }
    case "multicam.remove": {
      const t = timeline(p, c.timelineId);
      t.multicam = t.multicam.filter((g) => g.id !== c.groupId);
      t.clips.forEach((c2) => {
        if (c2.groupId === c.groupId) delete c2.groupId;
      });
      break;
    }
    case "marker.update":
      Object.assign(
        requireValue(
          timeline(p, c.timelineId).markers.find((m) => m.id === c.markerId),
          "标记",
        ),
        c.patch,
      );
      break;
    case "marker.remove": {
      const t = timeline(p, c.timelineId);
      requireValue(
        t.markers.find((m) => m.id === c.markerId),
        "标记",
      );
      t.markers = t.markers.filter((m) => m.id !== c.markerId);
      break;
    }
    case "clip.link": {
      const t = timeline(p, c.timelineId);
      c.clipIds.forEach((cid) => {
        const item = clip(t, cid);
        if (t.tracks.find((tr) => tr.id === item.trackId)?.locked)
          throw new DomainError("TRACK_LOCKED", "请先解锁轨道");
        if (c.linkId) item.linkId = c.linkId;
        else delete item.linkId;
      });
      break;
    }
    case "timeline.update": {
      const t = timeline(p, c.timelineId);
      if (c.patch.background !== undefined) t.background = c.patch.background;
      if (c.patch.watermark === null) delete t.watermark;
      else if (c.patch.watermark) t.watermark = c.patch.watermark;
      break;
    }
    case "styles.update":
      if (c.patch.captions) p.styles.captions = c.patch.captions;
      if (c.patch.brand) p.styles.brand = c.patch.brand;
      break;
    case "story.development":
      Object.assign(p.story.development, c.development);
      break;
    case "story.episode.upsert":
      replace(p.story.episodes, c.episode);
      p.story.episodes.sort((a, b) => a.number - b.number);
      break;
    case "story.episode.remove": {
      const episode = requireValue(
        p.story.episodes.find((e) => e.id === c.episodeId),
        "分集",
      );
      const scenes = new Set(episode.scenes.map((x) => x.id));
      p.story.episodes = p.story.episodes.filter((e) => e.id !== c.episodeId);
      p.story.shots.forEach((s) => {
        if (s.episodeId === c.episodeId) delete s.episodeId;
        if (s.sceneId && scenes.has(s.sceneId)) delete s.sceneId;
      });
      p.story.script.forEach((r) => {
        if (r.sceneId && scenes.has(r.sceneId)) delete r.sceneId;
      });
      break;
    }
    case "story.script.set":
      p.story.script = [...c.rows].sort((a, b) => a.number - b.number);
      break;
    case "transcript.gaps":
      compressPauses(p, c);
      break;
    case "project.trash":
      if (c.trashed) p.trashedAt = now;
      else delete p.trashedAt;
      break;
    default: {
      const exhaustive: never = c;
      throw new Error(String(exhaustive));
    }
  }
}
export function validateProject(value: unknown): Project {
  const p = projectSchema.parse(value);
  const ensureIds = <T extends { id: string }>(items: T[], label: string) => {
    if (new Set(items.map((i) => i.id)).size !== items.length)
      throw new DomainError("DUPLICATE_ID", `${label} ID 重复`);
  };
  ensureIds(p.assets, "素材");
  ensureIds(p.timelines, "时间线");
  ensureIds(p.story.shots, "镜头");
  ensureIds(p.story.entities, "实体");
  if (!p.timelines.some((t) => t.id === p.activeTimelineId))
    throw new DomainError("ACTIVE_TIMELINE", "当前时间线不存在");
  for (const t of p.timelines) {
    ensureIds(t.tracks, "轨道");
    ensureIds(t.clips, "片段");
    for (const c of t.clips) {
      if (
        !t.tracks.some((x) => x.id === c.trackId) ||
        !p.assets.some((a) => a.id === c.assetId)
      )
        throw new DomainError(
          "BROKEN_REFERENCE",
          "片段引用了不存在的素材或轨道",
        );
      for (const keys of Object.values(c.keyframes))
        if (keys?.some((k) => k.frame >= c.duration))
          throw new DomainError("KEYFRAME_OUTSIDE", "关键帧超出片段");
      for (const preset of c.effects.presets)
        try {
          effectParams(preset.id, preset.params);
        } catch (error) {
          throw new DomainError("EFFECT_PRESET", (error as Error).message);
        }
    }
    t.multicam = t.multicam.filter(
      (g) =>
        g.cameraClipIds.filter((id) => t.clips.some((c) => c.id === id))
          .length >= 2,
    );
    for (const g of t.multicam) {
      g.cameraClipIds = g.cameraClipIds.filter((id) =>
        t.clips.some((c) => c.id === id),
      );
      g.switches = g.switches.filter((s) => g.cameraClipIds.includes(s.clipId));
    }
  }
  for (const e of p.story.entities)
    if (e.referenceAssetIds.some((id) => !p.assets.some((a) => a.id === id)))
      throw new DomainError("BROKEN_REFERENCE", "实体参考素材不存在");
  for (const t of p.transcripts)
    if (!p.assets.some((a) => a.id === t.assetId))
      throw new DomainError("BROKEN_REFERENCE", "文稿素材不存在");
  const exists = (assetId: string | undefined) =>
    !assetId || p.assets.some((a) => a.id === assetId);
  for (const s of p.story.shots)
    if (
      !exists(s.assetId) ||
      !exists(s.frameAssetId) ||
      !exists(s.videoAssetId) ||
      !exists(s.voiceAssetId)
    )
      throw new DomainError("BROKEN_REFERENCE", "分镜素材不存在");
  for (const e of p.story.entities)
    if (
      !e.candidateAssetIds.every(exists) ||
      !Object.values(e.views).every(exists)
    )
      throw new DomainError("BROKEN_REFERENCE", "实体候选图或视图不存在");
  if (!exists(p.styles.brand.logoAssetId))
    throw new DomainError("BROKEN_REFERENCE", "品牌 Logo 素材不存在");
  ensureIds(p.story.episodes, "分集");
  ensureIds(
    p.story.episodes.flatMap((e) => e.scenes),
    "场",
  );
  ensureIds(p.story.script, "脚本行");
  ensureIds(p.styles.captions, "字幕样式");
  for (const t of p.timelines) {
    ensureIds(t.markers, "标记");
    if (!exists(t.watermark?.assetId))
      throw new DomainError("BROKEN_REFERENCE", "水印素材不存在");
  }
  for (const a of p.assets)
    if (
      a.kind === "sequence" &&
      !p.timelines.some((t) => t.id === a.sequenceTimelineId)
    )
      throw new DomainError("BROKEN_REFERENCE", "嵌套序列的时间线不存在");
  // A sequence cannot contain itself, directly or through another sequence.
  const visiting = new Set<string>(),
    done = new Set<string>();
  const visit = (t: Timeline) => {
    if (done.has(t.id)) return;
    if (visiting.has(t.id))
      throw new DomainError("SEQUENCE_CYCLE", "嵌套序列不能包含自己");
    visiting.add(t.id);
    for (const nested of nestedTimelines(p, t)) {
      const inner = p.timelines.find((x) => x.id === nested);
      if (inner) visit(inner);
    }
    visiting.delete(t.id);
    done.add(t.id);
  };
  p.timelines.forEach(visit);
  return p;
}
export function applyTransaction(
  project: Project,
  input: unknown,
  now: string,
): { project: Project; transaction: Transaction } {
  const txn = transactionSchema.parse(input);
  if (txn.expectedRevision !== project.revision)
    throw new DomainError("REVISION_CONFLICT", "项目已发生变化，请刷新后重试", {
      expected: txn.expectedRevision,
      current: project.revision,
    });
  const next = structuredClone(project);
  for (const command of txn.commands)
    apply(next, commandSchema.parse(command), now);
  next.revision = project.revision + 1;
  next.updatedAt = now;
  return { project: validateProject(next), transaction: txn };
}
