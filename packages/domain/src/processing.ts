import { z } from "zod";
import { speedCurveSchema } from "./advanced-model";
import { clipSchema, type Clip } from "./model";

const unit = z.number().min(0).max(1);
const rect = z
  .object({ x: unit, y: unit, width: unit.positive(), height: unit.positive() })
  .strict()
  .refine((r) => r.x + r.width <= 1 && r.y + r.height <= 1, "区域超出画面");
export const mediaOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("lyrics"),
      providerId: z.string(),
      isolationProviderId: z.string().optional(),
      styleId: z.string().default("karaoke"),
    })
    .strict(),
  z
    .object({ type: z.literal("speed-curve"), points: speedCurveSchema })
    .strict(),
  z.object({ type: z.literal("reverse") }).strict(),
  z
    .object({
      type: z.literal("freeze"),
      at: z.number().nonnegative(),
      seconds: z.number().positive().max(600).default(3),
    })
    .strict(),
  z
    .object({
      type: z.literal("interpolate"),
      fps: z.number().min(1).max(120),
      method: z.enum(["blend", "optical-flow"]).default("optical-flow"),
    })
    .strict(),
  z
    .object({
      type: z.literal("stabilize"),
      strength: z.number().int().min(1).max(64).default(16),
      crop: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("voice"),
      semitones: z.number().min(-12).max(12).default(0),
      pan: z.number().min(-1).max(1).default(0),
      preset: z
        .enum(["clean", "deep", "bright", "radio", "echo", "robot"])
        .default("clean"),
    })
    .strict(),
  z
    .object({
      type: z.literal("proxy"),
      width: z.number().int().min(160).max(1920).default(960),
    })
    .strict(),
  z.object({ type: z.literal("prerender") }).strict(),
  z
    .object({
      type: z.literal("track"),
      region: rect,
      mode: z.enum(["position", "plane"]).default("position"),
      targetClipId: z.string().optional(),
      maskId: z.string().optional(),
      sampleFps: z.number().min(1).max(30).default(12),
    })
    .strict(),
  z
    .object({
      type: z.literal("color-convert"),
      input: z.enum(["rec709", "srgb", "rec2020-pq", "rec2020-hlg"]),
      output: z.enum(["rec709", "srgb", "rec2020-pq", "rec2020-hlg"]),
      peakNits: z.number().min(100).max(10000).default(1000),
    })
    .strict(),
  z
    .object({
      type: z.literal("remove-background"),
      providerId: z.string(),
      backgroundAssetId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("inpaint"),
      providerId: z.string(),
      maskAssetId: z.string().optional(),
      maskId: z.string().optional(),
      prompt: z
        .string()
        .max(4000)
        .default(
          "Remove the masked object and reconstruct the background consistently across frames.",
        ),
    })
    .strict(),
  z
    .object({
      type: z.literal("upscale"),
      providerId: z.string(),
      scale: z.enum(["2", "4"]).default("2"),
    })
    .strict(),
  z
    .object({
      type: z.literal("avatar"),
      providerId: z.string(),
      audioAssetId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("lip-sync"),
      providerId: z.string(),
      audioAssetId: z.string(),
    })
    .strict(),
]);
export type MediaOperation = z.infer<typeof mediaOperationSchema>;
export const mediaProcessRequestSchema = z
  .object({
    assetId: z.string().optional(),
    timelineId: z.string().optional(),
    clipId: z.string().optional(),
    expectedRevision: z.number().int().nonnegative(),
    operation: mediaOperationSchema,
  })
  .strict()
  .refine((x) => Boolean(x.assetId || x.clipId), "需要选择素材或片段");
export type MediaProcessRequest = z.infer<typeof mediaProcessRequestSchema>;
export const processingFeatures = [
  {
    type: "lyrics",
    name: "歌词识别",
    tool: "transcribe_lyrics",
    local: false,
    capability: "transcription",
  },
  { type: "speed-curve", name: "曲线变速", tool: "retime_clip", local: true },
  { type: "reverse", name: "倒放", tool: "reverse_clip", local: true },
  { type: "freeze", name: "定格", tool: "freeze_clip", local: true },
  { type: "interpolate", name: "补帧", tool: "interpolate_clip", local: true },
  { type: "stabilize", name: "画面防抖", tool: "stabilize_clip", local: true },
  { type: "voice", name: "变调与声像", tool: "process_voice", local: true },
  { type: "proxy", name: "代理媒体", tool: "create_proxy", local: true },
  {
    type: "prerender",
    name: "预渲染缓存",
    tool: "prerender_clip",
    local: true,
  },
  { type: "track", name: "运动与平面跟踪", tool: "track_motion", local: true },
  {
    type: "color-convert",
    name: "色彩空间转换",
    tool: "convert_color_space",
    local: true,
  },
  {
    type: "remove-background",
    name: "智能抠像",
    tool: "remove_background",
    local: false,
    capability: "video-matte",
  },
  {
    type: "inpaint",
    name: "视频消除",
    tool: "inpaint_video",
    local: false,
    capability: "video-inpaint",
  },
  {
    type: "upscale",
    name: "AI 超分",
    tool: "upscale_video",
    local: false,
    capability: "video-upscale",
  },
  {
    type: "avatar",
    name: "数字人",
    tool: "create_avatar",
    local: false,
    capability: "avatar",
  },
  {
    type: "lip-sync",
    name: "口型同步",
    tool: "sync_lips",
    local: false,
    capability: "lip-sync",
  },
] as const;
/** Replacing the source retains composition edits and rescales relative animations. */
export function processedClipPatch(
  clip: Clip,
  assetId: string,
  duration: number,
  reverse = false,
): Partial<Clip> {
  const ratio = duration / clip.duration;
  const frame = (f: number) =>
    Math.min(
      duration - 1,
      Math.max(0, Math.round((reverse ? clip.duration - 1 - f : f) * ratio)),
    );
  const keys = <T extends { frame: number }>(v: T[]) =>
    [
      ...new Map(
        v.map((k) => [frame(k.frame), { ...k, frame: frame(k.frame) }]),
      ).values(),
    ].sort((a, b) => a.frame - b.frame);
  const value = structuredClone(clip);
  value.assetId = assetId;
  value.duration = duration;
  value.sourceOffset = 0;
  value.speed = 1;
  value.fadeIn = Math.min(duration, Math.round(clip.fadeIn * ratio));
  value.fadeOut = Math.min(duration, Math.round(clip.fadeOut * ratio));
  if (value.transition)
    value.transition.duration = Math.min(
      duration,
      Math.max(1, Math.round(value.transition.duration * ratio)),
    );
  for (const prop of Object.keys(
    value.keyframes,
  ) as (keyof Clip["keyframes"])[])
    value.keyframes[prop] = keys(value.keyframes[prop] ?? []);
  for (const mask of value.advanced?.masks ?? []) mask.keys = keys(mask.keys);
  if (value.advanced?.tracking)
    value.advanced.tracking.samples = keys(value.advanced.tracking.samples);
  clipSchema.parse(value);
  const { id: _id, ...patch } = value;
  return patch;
}
export function processingSourceKinds(type: string): string[] {
  if (type === "prerender")
    return ["video", "image", "text", "motion", "sequence"];
  if (type === "avatar") return ["image"];
  if (type === "freeze") return ["video", "image"];
  if (["lyrics", "voice", "reverse", "speed-curve"].includes(type))
    return ["video", "audio"];
  return ["video"];
}
