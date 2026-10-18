import { z } from "zod";
import {
  assetSchema,
  brandSchema,
  captionStyleSchema,
  clipSchema,
  developmentSchema,
  entitySchema,
  episodeSchema,
  frame,
  id,
  keyframeSchema,
  keyframeProperties,
  markerSchema,
  scriptRowSchema,
  shotSchema,
  timelineSchema,
  trackSchema,
  watermarkSchema,
  wordSchema,
  multicamSchema,
} from "./model";

const clipPatch = clipSchema.partial().omit({ id: true });
export const commandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("project.rename"),
      name: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({ type: z.literal("project.archive"), archived: z.boolean() })
    .strict(),
  z.object({ type: z.literal("asset.add"), asset: assetSchema }).strict(),
  z
    .object({
      type: z.literal("asset.update"),
      assetId: id,
      patch: assetSchema.partial().omit({ id: true }),
    })
    .strict(),
  z.object({ type: z.literal("asset.remove"), assetId: id }).strict(),
  z
    .object({ type: z.literal("timeline.create"), timeline: timelineSchema })
    .strict(),
  z.object({ type: z.literal("timeline.activate"), timelineId: id }).strict(),
  z
    .object({
      type: z.literal("timeline.rename"),
      timelineId: id,
      name: z.string().min(1),
    })
    .strict(),
  z.object({ type: z.literal("timeline.remove"), timelineId: id }).strict(),
  z
    .object({
      type: z.literal("timeline.resize"),
      timelineId: id,
      width: z.number().int().min(64).max(8192),
      height: z.number().int().min(64).max(8192),
    })
    .strict(),
  z
    .object({
      type: z.literal("track.add"),
      timelineId: id,
      track: trackSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("track.update"),
      timelineId: id,
      trackId: id,
      patch: trackSchema.partial().omit({ id: true }),
    })
    .strict(),
  z
    .object({ type: z.literal("track.remove"), timelineId: id, trackId: id })
    .strict(),
  z
    .object({
      type: z.literal("track.reorder"),
      timelineId: id,
      ids: z.array(id),
    })
    .strict(),
  z
    .object({ type: z.literal("clip.add"), timelineId: id, clip: clipSchema })
    .strict(),
  z
    .object({
      type: z.literal("clip.update"),
      timelineId: id,
      clipId: id,
      patch: clipPatch,
    })
    .strict(),
  z
    .object({
      type: z.literal("clip.remove"),
      timelineId: id,
      clipId: id,
      ripple: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      type: z.literal("clip.split"),
      timelineId: id,
      clipId: id,
      at: frame,
      newClipId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal("clip.keyframe"),
      timelineId: id,
      clipId: id,
      property: z.enum(keyframeProperties),
      keyframe: keyframeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("clip.keyframe.remove"),
      timelineId: id,
      clipId: id,
      property: z.enum(keyframeProperties),
      frame,
    })
    .strict(),
  z
    .object({
      type: z.literal("clip.group"),
      timelineId: id,
      clipIds: z.array(id).min(1),
      groupId: z.string().nullable(),
    })
    .strict(),
  z
    .object({ type: z.literal("story.entity.upsert"), entity: entitySchema })
    .strict(),
  z.object({ type: z.literal("story.entity.remove"), entityId: id }).strict(),
  z.object({ type: z.literal("story.shot.upsert"), shot: shotSchema }).strict(),
  z.object({ type: z.literal("story.shot.remove"), shotId: id }).strict(),
  z
    .object({
      type: z.literal("story.logline"),
      logline: z.string(),
      title: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("story.sync"),
      timelineId: id,
      direction: z.enum(["story-to-timeline", "timeline-to-story"]),
      trackId: id,
      force: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      type: z.literal("transcript.set"),
      transcript: z.object({
        id,
        assetId: id,
        language: z.string(),
        words: z.array(wordSchema),
      }),
    })
    .strict(),
  z
    .object({
      type: z.literal("transcript.cut"),
      transcriptId: id,
      wordIds: z.array(id).min(1),
      timelineId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal("transcript.speaker"),
      transcriptId: id,
      from: z.string(),
      to: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("canvas.upsert"),
      node: z.object({
        id,
        kind: z.enum(["note", "asset", "entity", "shot"]),
        x: z.number(),
        y: z.number(),
        label: z.string(),
        referenceId: z.string().optional(),
      }),
    })
    .strict(),
  z.object({ type: z.literal("canvas.remove"), nodeId: id }).strict(),
  z
    .object({
      type: z.literal("memory.upsert"),
      memory: z.object({
        id,
        text: z.string(),
        tags: z.array(z.string()),
        updatedAt: z.string(),
      }),
    })
    .strict(),
  z
    .object({
      type: z.literal("marker.add"),
      timelineId: id,
      marker: markerSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("marker.update"),
      timelineId: id,
      markerId: id,
      patch: markerSchema.partial().omit({ id: true }),
    })
    .strict(),
  z
    .object({ type: z.literal("marker.remove"), timelineId: id, markerId: id })
    .strict(),
  z
    .object({
      type: z.literal("clip.link"),
      timelineId: id,
      clipIds: z.array(id).min(1),
      linkId: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("timeline.update"),
      timelineId: id,
      patch: z
        .object({
          background: z.string().optional(),
          watermark: watermarkSchema.nullable().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("styles.update"),
      patch: z
        .object({
          captions: z.array(captionStyleSchema).max(60).optional(),
          brand: brandSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("story.development"),
      development: developmentSchema.partial(),
    })
    .strict(),
  z
    .object({ type: z.literal("story.episode.upsert"), episode: episodeSchema })
    .strict(),
  z.object({ type: z.literal("story.episode.remove"), episodeId: id }).strict(),
  z
    .object({
      type: z.literal("story.script.set"),
      rows: z.array(scriptRowSchema).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal("transcript.gaps"),
      transcriptId: id,
      timelineId: id,
      /** Pauses longer than this many seconds are shortened to it. */
      maxGap: z.number().min(0.05).max(10),
    })
    .strict(),
  z.object({ type: z.literal("project.trash"), trashed: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("multicam.create"),
      timelineId: id,
      group: multicamSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("multicam.switch"),
      timelineId: id,
      groupId: id,
      frame,
      clipId: id,
    })
    .strict(),
  z
    .object({ type: z.literal("multicam.remove"), timelineId: id, groupId: id })
    .strict(),
  z.object({ type: z.literal("memory.remove"), memoryId: id }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export const transactionSchema = z
  .object({
    requestId: id,
    expectedRevision: frame,
    label: z.string().max(300),
    commands: z.array(commandSchema).min(1).max(500),
  })
  .strict();
export type Transaction = z.infer<typeof transactionSchema>;
