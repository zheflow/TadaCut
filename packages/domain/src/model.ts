import { z } from "zod";
import {
  canvasNodeSchema,
  clipAdvancedSchema,
  mediaVariantSchema,
  provenanceSchema,
  timelineProfileSchema,
} from "./advanced-model";

export const frame = z.number().int().nonnegative();
export const positiveFrames = z.number().int().positive();
export const id = z.string().min(1).max(180);
export const assetSchema = z
  .object({
    id,
    name: z.string().min(1).max(300),
    kind: z.enum(["video", "image", "audio", "text", "motion", "sequence"]),
    url: z.string().max(2000).default(""),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    duration: z.number().nonnegative().optional(),
    size: z.number().nonnegative().optional(),
    hash: z.string().optional(),
    tags: z.array(z.string()).default([]),
    description: z.string().default(""),
    folder: z.string().default("素材"),
    color: z.string().default("#5b94ae"),
    thumbnail: z.string().optional(),
    code: z.string().max(100000).optional(),
    text: z.string().max(100000).optional(),
    embedding: z.array(z.number()).optional(),
    mime: z.string().optional(),
    provider: z.string().optional(),
    originalPath: z.string().optional(),
    alpha: z.boolean().optional(),
    proxy: mediaVariantSchema.optional(),
    provenance: provenanceSchema.optional(),
    colorSpace: z
      .enum(["rec709", "srgb", "rec2020-pq", "rec2020-hlg"])
      .optional(),
    /** For a nested sequence: the timeline it plays. */
    sequenceTimelineId: z.string().optional(),
    /** Where an installed extension or online library supplied the asset. */
    source: z
      .object({
        kind: z.enum(["stock", "plugin", "url", "generated"]),
        name: z.string().max(200),
        url: z.string().max(2000).optional(),
        license: z.string().max(300).optional(),
        author: z.string().max(200).optional(),
      })
      .optional(),
    createdAt: z.string(),
    waveform: z.array(z.number()).max(1000).optional(),
    timecode: z.string().optional(),
    clicks: z
      .array(
        z.object({
          time: z.number().nonnegative(),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
        }),
      )
      .optional(),
  })
  .strict();
export const keyframeSchema = z.object({
  frame,
  value: z.number().finite(),
  easing: z
    .enum(["linear", "ease-in", "ease-out", "ease-in-out", "hold", "bezier"])
    .default("linear"),
  /** Control points toward the next key, as in CSS cubic-bezier(x1, y1, x2, y2). */
  bezier: z
    .tuple([
      z.number().min(0).max(1),
      z.number().min(-2).max(3),
      z.number().min(0).max(1),
      z.number().min(-2).max(3),
    ])
    .optional(),
});
export const keyframeProperties = [
  "x",
  "y",
  "scale",
  "scaleX",
  "scaleY",
  "rotation",
  "opacity",
  "volume",
  "focusX",
  "focusY",
  "radius",
] as const;
export type KeyframeProperty = (typeof keyframeProperties)[number];
export const effectSchema = z.object({
  brightness: z.number().min(0).max(3).default(1),
  contrast: z.number().min(0).max(3).default(1),
  saturation: z.number().min(0).max(3).default(1),
  blur: z.number().min(0).max(60).default(0),
  chromaKey: z.string().optional(),
  chromaSimilarity: z.number().min(0).max(1).default(0.25),
  lutAssetId: z.string().optional(),
  shader: z.string().max(20000).optional(),
  lift: z
    .tuple([
      z.number().min(-1).max(1),
      z.number().min(-1).max(1),
      z.number().min(-1).max(1),
    ])
    .default([0, 0, 0]),
  gamma: z.number().min(0.1).max(5).default(1),
  gain: z
    .tuple([
      z.number().min(0).max(4),
      z.number().min(0).max(4),
      z.number().min(0).max(4),
    ])
    .default([1, 1, 1]),
  black: z.number().min(0).max(0.99).default(0),
  white: z.number().min(0.01).max(1).default(1),
  lumaKey: z.number().min(0).max(1).optional(),
  /** Library effects applied in order before grading. */
  presets: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        params: z.record(z.number().finite()).default({}),
      }),
    )
    .max(8)
    .default([]),
});
export const transitionKinds = [
  "dissolve",
  "fade",
  "wipe",
  "slide",
  "soft-wipe",
  "circle",
  "diamond",
  "clock",
  "blinds",
  "checker",
  "noise",
  "pixelate",
  "zoom",
  "spin",
  "flash",
  "dip",
  "glitch",
  "ripple",
] as const;
export type TransitionKind = (typeof transitionKinds)[number];
export const captionAnimations = [
  "none",
  "fade",
  "fade-up",
  "pop",
  "slide-up",
  "bounce",
  "typewriter",
  "word-pop",
  "karaoke",
  "highlight",
] as const;
export type CaptionAnimation = (typeof captionAnimations)[number];
export const textStyleSchema = z.object({
  fontSize: z.number().min(8).max(300).default(48),
  color: z.string().default("#ffffff"),
  align: z.enum(["left", "center", "right"]).default("center"),
  bottom: z.number().default(0.12),
  background: z.string().default("transparent"),
  fontFamily: z.string().max(120).optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().min(0).max(40).default(0),
  shadow: z.string().optional(),
  letterSpacing: z.number().min(-0.2).max(1).default(0),
  lineHeight: z.number().min(0.8).max(3).default(1.25),
  /** Distance from the top as a fraction of the height; when set it wins over bottom. */
  top: z.number().min(0).max(1).optional(),
  maxWidth: z.number().min(0.1).max(1).default(0.86),
  uppercase: z.boolean().default(false),
  padding: z.number().min(0).max(80).default(0),
  boxRadius: z.number().min(0).max(80).default(0),
});
export type TextStyle = z.infer<typeof textStyleSchema>;
export const clipSchema = z
  .object({
    id,
    assetId: id,
    trackId: id,
    start: frame,
    duration: positiveFrames,
    sourceOffset: z.number().nonnegative().default(0),
    speed: z.number().min(0.05).max(16).default(1),
    advanced: clipAdvancedSchema.optional(),
    name: z.string().default(""),
    x: z.number().finite().default(0),
    y: z.number().finite().default(0),
    scale: z.number().min(0.01).max(20).default(1),
    scaleX: z.number().min(0.01).max(20).default(1),
    scaleY: z.number().min(0.01).max(20).default(1),
    /** Corner radius in timeline pixels. */
    radius: z.number().min(0).max(4000).default(0),
    /** Fractions cut from each edge, as in a layout cell. */
    crop: z
      .object({
        left: z.number().min(0).max(0.95).default(0),
        top: z.number().min(0).max(0.95).default(0),
        right: z.number().min(0).max(0.95).default(0),
        bottom: z.number().min(0).max(0.95).default(0),
      })
      .optional(),
    rotation: z.number().finite().default(0),
    opacity: z.number().min(0).max(1).default(1),
    volume: z.number().min(0).max(4).default(1),
    fadeIn: frame.default(0),
    fadeOut: frame.default(0),
    fit: z.enum(["cover", "contain"]).default("cover"),
    keyframes: z
      .record(z.enum(keyframeProperties), z.array(keyframeSchema))
      .default({}),
    effects: effectSchema.default({}),
    groupId: z.string().optional(),
    /** Clips with the same link move, trim and ripple together, like picture and its sound. */
    linkId: z.string().optional(),
    shotId: z.string().optional(),
    transition: z
      .object({
        kind: z.enum(transitionKinds),
        duration: positiveFrames,
        direction: z.enum(["left", "right", "up", "down"]).optional(),
        /** A GLSL transition from an extension; kind is its fallback. */
        shader: z.string().max(20000).optional(),
      })
      .optional(),
    text: z.string().optional(),
    textStyle: textStyleSchema.optional(),
    caption: z
      .object({
        styleId: z.string().optional(),
        animation: z.enum(captionAnimations).default("none"),
        /** Color of the word being spoken. */
        highlight: z.string().optional(),
        /** Word timing in clip-local frames, for word animations. */
        words: z
          .array(
            z.object({ text: z.string(), start: frame, end: frame }).strict(),
          )
          .max(400)
          .optional(),
        /** The text before translation. */
        original: z.string().optional(),
        language: z.string().max(40).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const trackSchema = z
  .object({
    id,
    name: z.string().min(1),
    kind: z.enum(["video", "audio", "text", "motion"]),
    muted: z.boolean().default(false),
    hidden: z.boolean().default(false),
    locked: z.boolean().default(false),
    volume: z.number().min(0).max(4).default(1),
    color: z.string().default("#4b8b9e"),
    /** Ripple edits on other tracks shift this track too. */
    syncLock: z.boolean().default(false),
    /** What the sound is, so music can duck under dialogue. */
    role: z
      .enum(["dialogue", "music", "effects", "voiceover", "other"])
      .optional(),
  })
  .strict();
export const multicamSchema = z
  .object({
    id,
    name: z.string(),
    cameraClipIds: z.array(id).min(2),
    switches: z.array(z.object({ frame, clipId: id })),
    audioClipId: id.optional(),
  })
  .strict();
export const markerSchema = z.object({
  id,
  frame,
  label: z.string(),
  color: z.string(),
  /** A marker can cover a range, such as a highlight or a beat section. */
  duration: frame.default(0),
  note: z.string().max(2000).default(""),
});
export type Marker = z.infer<typeof markerSchema>;
export const watermarkSchema = z
  .object({
    assetId: z.string().optional(),
    text: z.string().max(200).optional(),
    position: z
      .enum(["top-left", "top-right", "bottom-left", "bottom-right", "center"])
      .default("bottom-right"),
    opacity: z.number().min(0).max(1).default(0.7),
    /** Width as a fraction of the frame width. */
    scale: z.number().min(0.02).max(1).default(0.12),
    margin: z.number().min(0).max(0.3).default(0.03),
  })
  .strict();
export type Watermark = z.infer<typeof watermarkSchema>;
export const timelineSchema = z
  .object({
    id,
    name: z.string().min(1),
    fps: z.number().finite().min(1).max(120),
    profile: timelineProfileSchema.optional(),
    width: z.number().int().min(64).max(8192),
    height: z.number().int().min(64).max(8192),
    background: z.string().default("#101114"),
    tracks: z.array(trackSchema),
    clips: z.array(clipSchema),
    markers: z.array(markerSchema).default([]),
    multicam: z.array(multicamSchema).default([]),
    watermark: watermarkSchema.optional(),
  })
  .strict();
export const entitySchema = z
  .object({
    id,
    kind: z.enum(["character", "scene", "prop"]),
    name: z.string().min(1),
    description: z.string().default(""),
    /** Visual identity kept the same in every shot: face, clothing, colors, materials. */
    traits: z.string().default(""),
    referenceAssetIds: z.array(id).default([]),
    /** Generated options waiting for the user to pick. */
    candidateAssetIds: z.array(id).default([]),
    /** Character turnaround views. */
    views: z
      .object({
        front: id.optional(),
        side: id.optional(),
        back: id.optional(),
      })
      .default({}),
    voice: z.string().max(200).optional(),
    confirmed: z.boolean().default(false),
  })
  .strict();
export const shotSchema = z
  .object({
    id,
    number: z.number().int().positive(),
    title: z.string(),
    description: z.string(),
    dialogue: z.string().default(""),
    duration: z.number().min(0.1).max(3600),
    assetId: z.string().optional(),
    entityIds: z.array(id).default([]),
    status: z
      .enum(["draft", "ready", "generating", "done", "error"])
      .default("draft"),
    prompt: z.string().default(""),
    syncBaseline: z.string().optional(),
    episodeId: z.string().optional(),
    sceneId: z.string().optional(),
    /** Shot size, angle and movement. */
    camera: z.string().default(""),
    /** Storyboard still, generated or chosen, that the video starts from. */
    frameAssetId: id.optional(),
    videoAssetId: id.optional(),
    voiceAssetId: id.optional(),
    production: z
      .object({
        stage: z
          .enum(["planned", "frame", "video", "voice", "assembled"])
          .default("planned"),
        /** The inputs the latest output was made from. */
        fingerprint: z.string().optional(),
        history: z
          .array(
            z
              .object({
                stage: z.enum(["frame", "video", "voice"]),
                assetId: id,
                provider: z.string().default(""),
                prompt: z.string().default(""),
                fingerprint: z.string().default(""),
                at: z.string(),
              })
              .strict(),
          )
          .max(40)
          .default([]),
        error: z.string().optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export const sceneSchema = z
  .object({
    id,
    number: z.number().int().positive(),
    title: z.string(),
    summary: z.string().default(""),
    location: z.string().default(""),
    entityIds: z.array(id).default([]),
    beats: z.array(z.string()).max(60).default([]),
  })
  .strict();
export const episodeSchema = z
  .object({
    id,
    number: z.number().int().positive(),
    title: z.string(),
    summary: z.string().default(""),
    scenes: z.array(sceneSchema).max(200).default([]),
  })
  .strict();
export const scriptRowSchema = z
  .object({
    id,
    number: z.number().int().positive(),
    sceneId: z.string().optional(),
    shotId: z.string().optional(),
    visual: z.string().default(""),
    narration: z.string().default(""),
    dialogue: z.string().default(""),
    speaker: z.string().default(""),
    /** Seconds. */
    duration: z.number().min(0.1).max(3600).default(3),
    notes: z.string().default(""),
  })
  .strict();
export const developmentSchema = z
  .object({
    premise: z.string().default(""),
    theme: z.string().default(""),
    genre: z.string().default(""),
    tone: z.string().default(""),
    audience: z.string().default(""),
    world: z.string().default(""),
    synopsis: z.string().default(""),
    /** Length, aspect and platform the piece is made for. */
    format: z.string().default(""),
    /** A text asset holding the novel or source material, when adapting one. */
    sourceAssetId: z.string().optional(),
  })
  .strict();
export const captionStyleSchema = z
  .object({
    id,
    name: z.string().min(1).max(60),
    textStyle: textStyleSchema,
    animation: z.enum(captionAnimations).default("none"),
    highlight: z.string().optional(),
  })
  .strict();
export type CaptionStyle = z.infer<typeof captionStyleSchema>;
export const brandSchema = z
  .object({
    name: z.string().default(""),
    colors: z.array(z.string()).max(12).default([]),
    fonts: z.array(z.string()).max(6).default([]),
    logoAssetId: z.string().optional(),
    /** Voice and wording the brand uses. */
    tone: z.string().default(""),
  })
  .strict();
export const wordSchema = z
  .object({
    id,
    text: z.string(),
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    speaker: z.string().default("说话人 1"),
    deleted: z.boolean().default(false),
  })
  .refine((w) => w.end >= w.start);
export const projectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    name: z.string().min(1).max(200),
    revision: frame,
    createdAt: z.string(),
    updatedAt: z.string(),
    assets: z.array(assetSchema),
    timelines: z.array(timelineSchema).min(1),
    activeTimelineId: id,
    story: z.object({
      title: z.string(),
      logline: z.string(),
      entities: z.array(entitySchema),
      shots: z.array(shotSchema),
      development: developmentSchema.default({}),
      episodes: z.array(episodeSchema).max(200).default([]),
      script: z.array(scriptRowSchema).max(2000).default([]),
    }),
    transcripts: z.array(
      z.object({
        id,
        assetId: id,
        language: z.string(),
        words: z.array(wordSchema),
      }),
    ),
    canvas: z.array(canvasNodeSchema),
    memories: z.array(
      z.object({
        id,
        text: z.string(),
        tags: z.array(z.string()),
        updatedAt: z.string(),
      }),
    ),
    archived: z.boolean().default(false),
    /** Set while the project is in the trash. */
    trashedAt: z.string().optional(),
    styles: z
      .object({
        captions: z.array(captionStyleSchema).max(60).default([]),
        brand: brandSchema.default({}),
      })
      .default({}),
  })
  .strict();
export type Asset = z.infer<typeof assetSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Timeline = z.infer<typeof timelineSchema>;
export type Entity = z.infer<typeof entitySchema>;
export type Shot = z.infer<typeof shotSchema>;
export type Word = z.infer<typeof wordSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Transcript = Project["transcripts"][number];
export type Episode = z.infer<typeof episodeSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type ScriptRow = z.infer<typeof scriptRowSchema>;
export type Development = z.infer<typeof developmentSchema>;
export type Brand = z.infer<typeof brandSchema>;
export type Effects = Clip["effects"];
/** Visual layers share video and motion tracks; audio and text keep their own tracks. */
export const trackAccepts = (track: Track["kind"], asset: Asset["kind"]) =>
  track === "audio" || track === "text"
    ? asset === track
    : asset === "video" ||
      asset === "image" ||
      asset === "motion" ||
      asset === "sequence";
export const trackKindFor = (asset: Asset["kind"]): Track["kind"] =>
  asset === "image" || asset === "sequence" ? "video" : asset;
/** LUT files are color data for clip effects, not timeline media. */
export const isLutAsset = (asset: Pick<Asset, "name">) =>
  /\.cube$/i.test(asset.name);
const trackKindNames = {
    video: "画面",
    audio: "音频",
    text: "文字",
    motion: "动效",
  },
  assetKindNames = {
    video: "视频",
    image: "图片",
    audio: "音频",
    text: "文字",
    motion: "动画",
    sequence: "嵌套序列",
  };
/** Why an asset cannot sit on a track kind, or undefined when it can. */
export const placementIssue = (
  track: Track["kind"],
  asset: Pick<Asset, "kind" | "name">,
) =>
  isLutAsset(asset)
    ? "LUT 请在片段属性的调色中使用"
    : trackAccepts(track, asset.kind)
      ? undefined
      : `${trackKindNames[track]}轨道不能放置${assetKindNames[asset.kind]}素材`;
export const makeTimeline = (
  timelineId: string,
  name = "主时间线",
  fps = 30,
  width = 1920,
  height = 1080,
): Timeline =>
  timelineSchema.parse({
    id: timelineId,
    name,
    fps,
    width,
    height,
    tracks: [
      trackSchema.parse({
        id: `${timelineId}-v1`,
        name: "画面 01",
        kind: "video",
      }),
      trackSchema.parse({
        id: `${timelineId}-a1`,
        name: "配乐",
        kind: "audio",
        color: "#ac9166",
      }),
      trackSchema.parse({
        id: `${timelineId}-t1`,
        name: "字幕",
        kind: "text",
        color: "#ae96c7",
      }),
    ],
    clips: [],
  });
export function makeProject(
  projectId: string,
  name: string,
  now: string,
): Project {
  const timeline = makeTimeline(`${projectId}-main`);
  return projectSchema.parse({
    schemaVersion: 1,
    id: projectId,
    name,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    assets: [],
    timelines: [timeline],
    activeTimelineId: timeline.id,
    story: { title: name, logline: "", entities: [], shots: [] },
    transcripts: [],
    canvas: [],
    memories: [],
  });
}
export const activeTimeline = (p: Project) =>
  p.timelines.find((t) => t.id === p.activeTimelineId)!;
export const durationInFrames = (t: Timeline) =>
  Math.max(1, ...t.clips.map((c) => c.start + c.duration));
