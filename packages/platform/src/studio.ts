import { z } from "zod";

export const studioPages = [
  "studio",
  "projects",
  "library",
  "models",
  "skills",
  "extensions",
  "tasks",
  "settings",
] as const;
export const studioModes = [
  "edit",
  "story",
  "transcript",
  "record",
  "canvas",
] as const;
export const storyViews = [
  "board",
  "development",
  "episodes",
  "script",
  "production",
] as const;
export const resourceSections = [
  "templates",
  "captions",
  "effects",
  "transitions",
  "looks",
  "camera",
  "sounds",
  "stock",
  "fonts",
  "extensions",
] as const;
export const creativeToolIds = [
  "image",
  "video",
  "speech",
  "voice-clone",
  "music",
  "sfx",
  "image-edit",
  "ref-video",
  "cover",
  "motion-ai",
  "motion",
  "title",
  "transcript",
  "audio-labels",
  "subject-reframe",
  "analyze",
  "voice-clean",
  "voice-isolate",
  "scene-detect",
  "highlights",
  "normalize",
  "silence",
  "multicam",
  "reframe",
  "understand",
  "semantic",
  "web",
] as const;
export const referenceSchema = z
  .object({
    kind: z.enum([
      "clip",
      "asset",
      "project",
      "skill",
      "provider",
      "job",
      "extension",
    ]),
    id: z.string().min(1).max(200),
    name: z.string().max(300),
    projectId: z.string().max(200).optional(),
  })
  .strict();
export type StudioReference = z.infer<typeof referenceSchema>;
export const studioContextSchema = z
  .object({
    clientId: z.string().uuid().optional(),
    page: z.enum(studioPages),
    workspace: z.enum(studioModes),
    projectId: z.string(),
    projectName: z.string().max(300),
    timelineId: z.string().optional(),
    frame: z.number().nonnegative(),
    references: z.array(referenceSchema).max(100),
    theme: z.enum(["light", "dark", "system"]),
    sakuraEffects: z.boolean(),
    details: z.record(z.string().max(1000)).default({}),
    assistant: z
      .object({
        providerId: z.string(),
        backend: z.enum(["api", "codex", "claude", "copilot"]),
        mode: z.enum(["manual", "auto", "ask"]),
        skillId: z.string().nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type StudioContext = z.infer<typeof studioContextSchema>;
export const studioActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot") }).strict(),
  z
    .object({
      type: z.literal("navigate"),
      page: z.enum(studioPages),
      workspace: z.enum(studioModes).optional(),
      storyView: z.enum(storyViews).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("appearance"),
      theme: z.enum(["light", "dark", "system"]).optional(),
      sakuraEffects: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("open-project"), projectId: z.string().min(1) })
    .strict(),
  z
    .object({
      type: z.literal("provider-editor"),
      providerId: z.string().min(1),
    })
    .strict(),
  z
    .object({ type: z.literal("skill-editor"), skillId: z.string().min(1) })
    .strict(),
  z
    .object({
      type: z.literal("dialog"),
      dialog: z.enum(["export", "tools", "title", "project", "none"]),
    })
    .strict(),
  z
    .object({ type: z.literal("creative-tool"), tool: z.enum(creativeToolIds) })
    .strict(),
  z
    .object({
      type: z.literal("select"),
      references: z.array(referenceSchema).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("transport"),
      action: z.enum([
        "play",
        "pause",
        "seek",
        "step",
        "mark-in",
        "mark-out",
        "clear-marks",
      ]),
      frame: z.number().nonnegative().optional(),
      delta: z.number().int().min(-10000).max(10000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("view"),
      zoom: z.number().min(5).max(200).optional(),
      snap: z.boolean().optional(),
      inspector: z.boolean().optional(),
      safe: z.boolean().optional(),
      grid: z.boolean().optional(),
      leftPanel: z.enum(["media", "library"]).optional(),
      resourceSection: z.enum(resourceSections).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("choose-files"),
      kind: z.enum([
        "media",
        "project",
        "skill",
        "extension",
        "directory",
        "relink",
      ]),
      assetId: z.string().optional(),
    })
    .strict(),
  z.object({ type: z.literal("mcp-connection") }).strict(),
  z
    .object({
      type: z.literal("confirm"),
      tool: z.string().max(100),
      effect: z.enum([
        "read",
        "edit",
        "job",
        "generate",
        "external",
        "publish",
        "manage",
      ]),
      summary: z.string().max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal("assistant"),
      providerId: z.string().optional(),
      backend: z.enum(["api", "codex", "claude", "copilot"]).optional(),
      mode: z.enum(["manual", "auto", "ask"]).optional(),
      skillId: z.string().nullable().optional(),
    })
    .strict(),
]);
export type StudioAction = z.infer<typeof studioActionSchema>;
export const studioResultSchema = z
  .object({
    status: z.enum(["applied", "needs-user", "error"]),
    message: z.string().max(2000).optional(),
    context: studioContextSchema.optional(),
  })
  .strict();
export type StudioResult = z.infer<typeof studioResultSchema>;
export interface ApplicationBridge {
  /** Internal adapters choose fixed routes; this is never offered as a model tool. */
  request(
    method: "GET" | "POST" | "DELETE",
    url: string,
    body?: unknown,
  ): Promise<unknown>;
  control(
    projectId: string,
    action: StudioAction,
    signal: AbortSignal,
    clientId?: string,
  ): Promise<StudioResult>;
}
