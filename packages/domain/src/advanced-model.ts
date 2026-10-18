import { z } from "zod";

const unit = z.number().finite().min(0).max(1);
const point = z.tuple([unit, unit]);
const curve = z
  .array(point)
  .min(2)
  .max(32)
  .superRefine((points, ctx) => {
    if (
      points[0][0] !== 0 ||
      points.at(-1)![0] !== 1 ||
      points.some((p, i) => i > 0 && p[0] <= points[i - 1][0])
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "曲线必须从 0 到 1，横坐标严格递增",
      });
  });
export const blendModes = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
export const maskKeySchema = z
  .object({
    frame: z.number().int().nonnegative(),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive().max(4),
    height: z.number().positive().max(4),
    rotation: z.number().finite().default(0),
    feather: unit.default(0),
  })
  .strict();
export const maskSchema = z
  .object({
    id: z.string().min(1).max(180),
    shape: z.enum(["rectangle", "ellipse", "polygon", "bezier", "brush"]),
    x: z.number().finite().min(-2).max(2).default(0.5),
    y: z.number().finite().min(-2).max(2).default(0.5),
    width: z.number().positive().max(4).default(0.7),
    height: z.number().positive().max(4).default(0.7),
    rotation: z.number().finite().default(0),
    feather: unit.default(0),
    inverted: z.boolean().default(false),
    opacity: unit.default(1),
    operation: z.enum(["add", "subtract", "intersect"]).default("add"),
    points: z.array(point).min(3).max(128).optional(),
    /** Each anchor has optional incoming/outgoing control points in normalized mask space. */
    anchors: z
      .array(
        z
          .object({
            point,
            incoming: point.optional(),
            outgoing: point.optional(),
          })
          .strict(),
      )
      .min(3)
      .max(64)
      .optional(),
    strokes: z
      .array(
        z
          .object({
            points: z.array(point).min(1).max(2000),
            radius: unit,
            erase: z.boolean().default(false),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    keys: z.array(maskKeySchema).max(20000).default([]),
  })
  .strict();
export type ClipMask = z.infer<typeof maskSchema>;

export const colorCurvesSchema = z
  .object({
    master: curve.optional(),
    red: curve.optional(),
    green: curve.optional(),
    blue: curve.optional(),
  })
  .strict();
export const hslBandSchema = z
  .object({
    center: z.number().min(0).max(360),
    width: z.number().positive().max(180).default(45),
    hue: z.number().min(-180).max(180).default(0),
    saturation: z.number().min(-1).max(1).default(0),
    lightness: z.number().min(-1).max(1).default(0),
  })
  .strict();
export const beautySchema = z
  .object({
    smooth: unit.default(0),
    brighten: unit.default(0),
    faceSlim: z.number().min(-1).max(1).default(0),
    eyeSize: z.number().min(-0.5).max(0.5).default(0),
    bodySlim: z.number().min(-1).max(1).default(0),
    face: z
      .object({ x: unit, y: unit, width: unit, height: unit })
      .strict()
      .default({ x: 0.5, y: 0.4, width: 0.35, height: 0.45 }),
    body: z
      .object({ x: unit, y: unit, width: unit, height: unit })
      .strict()
      .default({ x: 0.5, y: 0.6, width: 0.6, height: 0.8 }),
    leftEye: point.default([0.43, 0.35]),
    rightEye: point.default([0.57, 0.35]),
  })
  .strict();
export const trackingSampleSchema = z
  .object({
    frame: z.number().int().nonnegative(),
    corners: z.tuple([point, point, point, point]),
    confidence: unit,
  })
  .strict();
export const clipAdvancedSchema = z
  .object({
    blend: z.enum(blendModes).optional(),
    masks: z.array(maskSchema).max(8).optional(),
    curves: colorCurvesSchema.optional(),
    hsl: z.array(hslBandSchema).max(16).optional(),
    beauty: beautySchema.optional(),
    tracking: z
      .object({
        samples: z.array(trackingSampleSchema).min(1).max(20000),
        mode: z.enum(["position", "plane"]),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ClipAdvanced = z.infer<typeof clipAdvancedSchema>;

export const colorSpaces = [
  "rec709",
  "srgb",
  "rec2020-pq",
  "rec2020-hlg",
] as const;
export const timelineProfileSchema = z
  .object({
    rate: z
      .object({
        numerator: z.number().int().min(1).max(240000),
        denominator: z.number().int().min(1).max(1001),
      })
      .strict(),
    dropFrame: z.boolean().default(false),
    workingSpace: z.enum(colorSpaces).default("rec709"),
    outputSpace: z.enum(colorSpaces).default("rec709"),
    peakNits: z.number().min(100).max(10000).default(1000),
    proxyPreview: z.boolean().default(true),
  })
  .strict()
  .superRefine((p, ctx) => {
    const fps = p.rate.numerator / p.rate.denominator;
    if (fps < 1 || fps > 120)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "帧率须为 1–120" });
    if (
      p.dropFrame &&
      !(
        (p.rate.numerator === 30000 || p.rate.numerator === 60000) &&
        p.rate.denominator === 1001
      )
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "丢帧时间码仅支持 30000/1001 或 60000/1001",
      });
  });
export type TimelineProfile = z.infer<typeof timelineProfileSchema>;
export const mediaVariantSchema = z
  .object({
    url: z.string().regex(/^\/media\/[a-zA-Z0-9._-]+$/),
    hash: z.string(),
    width: z.number().positive(),
    height: z.number().positive(),
    sourceHash: z.string(),
    createdAt: z.string(),
  })
  .strict();
export const provenanceSchema = z
  .object({
    operation: z.string().min(1).max(80),
    sourceAssetIds: z.array(z.string()).max(20),
    parameters: z.record(z.unknown()),
    createdAt: z.string(),
  })
  .strict();

export const speedCurveSchema = z
  .array(
    z.object({ position: unit, speed: z.number().min(0.05).max(16) }).strict(),
  )
  .min(2)
  .max(32)
  .superRefine((v, ctx) => {
    if (
      v[0].position !== 0 ||
      v.at(-1)!.position !== 1 ||
      v.some((p, i) => i > 0 && p.position <= v[i - 1].position)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "速度曲线须从片段开头到结尾，位置严格递增",
      });
  });
export type SpeedCurve = z.infer<typeof speedCurveSchema>;

export const canvasNodeSchema = z
  .object({
    id: z.string().min(1).max(180),
    kind: z.enum([
      "note",
      "asset",
      "entity",
      "shot",
      "group",
      "audio",
      "video",
      "image",
      "character",
      "scene",
      "prop",
    ]),
    x: z.number().finite(),
    y: z.number().finite(),
    label: z.string().max(1000),
    referenceId: z.string().optional(),
    parentId: z.string().optional(),
    references: z.array(z.string()).max(100).optional(),
    history: z
      .array(
        z
          .object({
            assetId: z.string(),
            at: z.string(),
            reason: z.string().max(200),
          })
          .strict(),
      )
      .max(200)
      .optional(),
  })
  .strict();
