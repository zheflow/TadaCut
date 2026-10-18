import crypto from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { processingFeatures, mediaProcessRequestSchema } from "@tadacut/domain";
import { mediaBinary } from "./media";
import { runProcess } from "./process";
import { processResultCommands } from "./media-processing";
import { publicJob, type JobQueue } from "./jobs";
import type { Repository } from "./storage";
let availability:
  | { key: string; at: number; filters: string; encoders: string }
  | undefined;
export async function advancedCapabilities(repo: Repository) {
  const ffmpeg = mediaBinary("ffmpeg"),
    ffprobe = mediaBinary("ffprobe");
  if (
    ffmpeg &&
    (!availability ||
      availability.key !== ffmpeg ||
      Date.now() - availability.at > 60000)
  ) {
    const [filters, encoders] = await Promise.all([
      runProcess(ffmpeg, ["-hide_banner", "-filters"]),
      runProcess(ffmpeg, ["-hide_banner", "-encoders"]),
    ]);
    availability = {
      key: ffmpeg,
      at: Date.now(),
      filters: filters.stdout.toString(),
      encoders: encoders.stdout.toString(),
    };
  }
  const filters: Record<string, string[]> = {
    "speed-curve": ["setpts", "atempo"],
    reverse: ["reverse", "areverse"],
    freeze: ["fps"],
    interpolate: ["minterpolate"],
    stabilize: ["deshake"],
    voice: ["asetrate", "pan"],
    proxy: ["scale"],
    track: ["scale"],
    "color-convert": ["lut3d"],
  };
  const encodable = availability?.encoders.includes(
    process.platform === "darwin" ? "h264_videotoolbox" : "libx264",
  );
  return processingFeatures.map((f) => {
    const providers =
      "capability" in f
        ? repo
            .providers()
            .filter(
              (p) =>
                p.enabled &&
                p.capabilities.includes(f.capability as never) &&
                (p.kind !== "fal" || p.hasKey) &&
                !p.keyUnreadable,
            )
            .map((p) => ({ id: p.id, name: p.name }))
        : [];
    const missing = (filters[f.type] ?? []).filter(
      (filter) => !availability?.filters.includes(` ${filter} `),
    );
    const available = Boolean(
      ffmpeg &&
        ffprobe &&
        !missing.length &&
        (f.local ? encodable : providers.length),
    );
    return {
      ...f,
      available,
      providers,
      reason: available
        ? ""
        : !ffmpeg || !ffprobe
          ? "本机媒体处理组件缺失"
          : missing.length
            ? `缺少滤镜：${missing.join("、")}`
            : f.local
              ? "本机视频编码器不可用"
              : "先在模型页配置并启用对应能力",
    };
  });
}
export function registerAdvancedRoutes(
  app: FastifyInstance,
  ctx: {
    repo: Repository;
    jobs: JobQueue;
    publish(type: string, data: unknown): void;
  },
) {
  const { repo, jobs, publish } = ctx;
  app.get("/api/advanced/capabilities", () => advancedCapabilities(repo));
  app.post("/api/projects/:id/process", async (request) => {
    const { id } = request.params as { id: string },
      input = mediaProcessRequestSchema.parse(request.body),
      name = processingFeatures.find(
        (f) => f.type === input.operation.type,
      )!.name;
    return publicJob(jobs.enqueue(id, "process-media", name, input));
  });
  app.post("/api/projects/:id/process/:jobId/apply", async (request) => {
    const { id, jobId } = request.params as { id: string; jobId: string },
      body = z
        .object({
          expectedRevision: z.number().int().nonnegative(),
          requestId: z.string().optional(),
        })
        .strict()
        .parse(request.body);
    const result = processResultCommands(repo, id, jobId),
      committed = repo.commit(id, {
        requestId: body.requestId ?? crypto.randomUUID(),
        expectedRevision: body.expectedRevision,
        label: result.label,
        commands: result.commands,
      });
    publish("project", committed.project);
    return { project: committed.project, warnings: result.warnings };
  });
}
