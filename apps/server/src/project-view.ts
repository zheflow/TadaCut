import {
  clipSchema,
  durationInFrames,
  productionSummary,
  type Asset,
  type Clip,
  type Project,
  type Timeline,
} from "@tadacut/domain";

/** Model tool results stay below this size so nothing is cut mid-document. */
export const VIEW_LIMIT = 36000;
export const readProjectParameters = {
  type: "object",
  properties: {
    section: {
      type: "string",
      enum: [
        "overview",
        "assets",
        "asset",
        "timeline",
        "story",
        "script",
        "styles",
        "transcript",
      ],
      description:
        "overview（默认）返回概览；assets 分页列出素材；asset 返回单个素材全文（含动画代码）；timeline 返回完整时间线（含标记与水印）；story 返回开发设定、分集、设定与分镜；script 分页返回剧本表；styles 返回字幕样式与品牌；transcript 返回词级文稿。",
    },
    assetId: { type: "string" },
    timelineId: { type: "string", description: "默认是当前时间线" },
    transcriptId: { type: "string" },
    offset: { type: "number", description: "列表起点，从 0 开始" },
    limit: { type: "number", description: "本次最多返回的条目数" },
  },
  required: [],
  additionalProperties: false,
};
export interface ReadProjectArgs {
  section?: string;
  assetId?: string;
  timelineId?: string;
  transcriptId?: string;
  offset?: number;
  limit?: number;
}
const clipDefaults = clipSchema.parse({
  id: "_",
  assetId: "_",
  trackId: "_",
  start: 0,
  duration: 1,
});
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
/** A clip with only the fields that differ from their defaults. */
export function compactClip(c: Clip) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(c)) {
    const fallback = clipDefaults[key as keyof Clip];
    if (key === "effects") {
      const changed = Object.fromEntries(
        Object.entries(c.effects).filter(
          ([k, v]) =>
            !same(v, clipDefaults.effects[k as keyof Clip["effects"]]),
        ),
      );
      if (Object.keys(changed).length) out.effects = changed;
    } else if (
      ["id", "assetId", "trackId", "start", "duration"].includes(key) ||
      !same(value, fallback)
    )
      out[key] = value;
  }
  return out;
}
/** Asset facts a model needs to edit with; media bytes, vectors and local paths stay out. */
export function compactAsset(a: Asset) {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    ...(a.duration !== undefined ? { duration: a.duration } : {}),
    ...(a.width ? { width: a.width, height: a.height } : {}),
    ...(a.tags.length ? { tags: a.tags } : {}),
    ...(a.description ? { description: a.description.slice(0, 300) } : {}),
    ...(a.code ? { codeChars: a.code.length } : {}),
    ...(a.text ? { text: a.text.slice(0, 200) } : {}),
    ...(a.timecode ? { timecode: a.timecode } : {}),
  };
}
const timelineMeta = (t: Timeline) => ({
  id: t.id,
  name: t.name,
  width: t.width,
  height: t.height,
  fps: t.fps,
  durationFrames: durationInFrames(t),
  background: t.background,
});
const page = <T>(items: T[], args: ReadProjectArgs, fallback: number) => {
  const offset = Math.max(0, Math.floor(args.offset ?? 0)),
    limit = Math.max(1, Math.min(1000, Math.floor(args.limit ?? fallback)));
  return {
    items: items.slice(offset, offset + limit),
    offset,
    total: items.length,
    ...(offset + limit < items.length ? { nextOffset: offset + limit } : {}),
  };
};
/** Shrinks list pages until the view fits the tool result budget. */
function fitted(build: (limit: number) => unknown, limit: number): unknown {
  let view = build(limit);
  while (JSON.stringify(view).length > VIEW_LIMIT && limit > 1) {
    limit = Math.max(1, Math.floor(limit / 2));
    view = build(limit);
  }
  return view;
}
/** The project as the read_project tool shows it: an overview by default, with sections and pages for large projects. */
export function readProjectView(p: Project, args: ReadProjectArgs = {}) {
  const base = { id: p.id, name: p.name, revision: p.revision };
  const timeline =
    p.timelines.find((t) => t.id === args.timelineId) ??
    p.timelines.find((t) => t.id === p.activeTimelineId)!;
  switch (args.section ?? "overview") {
    case "assets":
      return fitted(
        (limit) => ({
          ...base,
          assets: page(p.assets.map(compactAsset), { ...args, limit }, limit),
        }),
        args.limit ?? 200,
      );
    case "asset": {
      const asset = p.assets.find((a) => a.id === args.assetId);
      if (!asset) throw new Error("请提供存在的 assetId");
      const { embedding, originalPath, waveform, thumbnail, clicks, ...rest } =
        asset;
      return {
        ...base,
        asset: { ...rest, ...(clicks ? { clicks: clicks.length } : {}) },
      };
    }
    case "timeline":
      return fitted(
        (limit) => ({
          ...base,
          timeline: {
            ...timelineMeta(timeline),
            tracks: timeline.tracks,
            markers: timeline.markers,
            multicam: timeline.multicam,
            ...(timeline.watermark ? { watermark: timeline.watermark } : {}),
            clips: page(
              [...timeline.clips]
                .sort((a, b) => a.start - b.start)
                .map(compactClip),
              { ...args, limit },
              limit,
            ),
          },
        }),
        args.limit ?? 300,
      );
    case "story":
      return fitted(
        (limit) => ({
          ...base,
          story: {
            title: p.story.title,
            logline: p.story.logline,
            development: p.story.development,
            episodes: p.story.episodes,
            entities: p.story.entities,
            production: productionSummary(p),
            scriptRows: p.story.script.length,
            shots: page(
              p.story.shots.map(({ syncBaseline, ...s }) => ({
                ...s,
                production: {
                  stage: s.production.stage,
                  takes: s.production.history.length,
                  ...(s.production.error ? { error: s.production.error } : {}),
                },
              })),
              { ...args, limit },
              limit,
            ),
          },
        }),
        args.limit ?? 200,
      );
    case "script":
      return fitted(
        (limit) => ({
          ...base,
          script: page(p.story.script, { ...args, limit }, limit),
        }),
        args.limit ?? 300,
      );
    case "styles":
      return { ...base, styles: p.styles };
    case "transcript": {
      const transcript =
        p.transcripts.find((t) => t.id === args.transcriptId) ??
        p.transcripts[0];
      if (!transcript) return { ...base, transcript: null };
      return fitted(
        (limit) => ({
          ...base,
          transcript: {
            id: transcript.id,
            assetId: transcript.assetId,
            language: transcript.language,
            words: page(transcript.words, { ...args, limit }, limit),
          },
        }),
        args.limit ?? 600,
      );
    }
    case "overview":
      return fitted((limit) => {
        const clips = [...timeline.clips].sort((a, b) => a.start - b.start);
        return {
          ...base,
          activeTimelineId: p.activeTimelineId,
          timelines: p.timelines.map((t) => ({
            ...timelineMeta(t),
            tracks: t.tracks.length,
            clips: t.clips.length,
          })),
          timeline: {
            ...timelineMeta(timeline),
            tracks: timeline.tracks,
            clips: clips.slice(0, limit).map(compactClip),
            clipCount: clips.length,
            markers: timeline.markers.slice(0, 40).map((m) => ({
              id: m.id,
              frame: m.frame,
              label: m.label,
              ...(m.duration ? { duration: m.duration } : {}),
            })),
            markerCount: timeline.markers.length,
            ...(timeline.watermark ? { watermark: timeline.watermark } : {}),
          },
          assets: p.assets.slice(0, limit).map(compactAsset),
          assetCount: p.assets.length,
          story: {
            title: p.story.title,
            logline: p.story.logline,
            entities: p.story.entities.map((e) => ({
              id: e.id,
              kind: e.kind,
              name: e.name,
            })),
            shots: p.story.shots.slice(0, limit).map((s) => ({
              id: s.id,
              number: s.number,
              title: s.title,
              duration: s.duration,
              ...(s.assetId ? { assetId: s.assetId } : {}),
              stage: s.production.stage,
            })),
            shotCount: p.story.shots.length,
            ...(p.story.development.premise || p.story.development.genre
              ? {
                  development: {
                    premise: p.story.development.premise.slice(0, 300),
                    genre: p.story.development.genre,
                    tone: p.story.development.tone,
                    format: p.story.development.format,
                  },
                }
              : {}),
            episodes: p.story.episodes.map((e) => ({
              id: e.id,
              number: e.number,
              title: e.title,
              scenes: e.scenes.length,
            })),
            scriptRows: p.story.script.length,
            ...(p.story.shots.length
              ? { production: productionSummary(p) }
              : {}),
          },
          styles: {
            captions: p.styles.captions.map((c) => ({
              id: c.id,
              name: c.name,
            })),
            ...(p.styles.brand.name || p.styles.brand.colors.length
              ? { brand: p.styles.brand }
              : {}),
          },
          transcripts: p.transcripts.map((t) => ({
            id: t.id,
            assetId: t.assetId,
            language: t.language,
            words: t.words.length,
          })),
          memories: p.memories.length,
          ...(clips.length > limit ||
          p.assets.length > limit ||
          p.story.shots.length > limit
            ? {
                note: "概览已省略部分条目。用 section=timeline/assets/story 与 offset、limit 分页读取完整内容。",
              }
            : {}),
        };
      }, 120);
    default:
      throw new Error("未知的 section");
  }
}
