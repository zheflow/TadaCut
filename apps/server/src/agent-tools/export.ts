import type { AgentTool } from "../../../../packages/agent/src/runner";
import { s, timeArgs, timelineOf, toFrames, tool, type ToolHost } from "./host";

/** An export the user can find again, with what the file check found. */
export interface ExportRecord {
  id: string;
  projectId: string;
  timelineId: string;
  kind: "video" | "clip" | "still" | "audio";
  filename: string;
  url: string;
  codec: string;
  size: number;
  createdAt: string;
  /** What the timeline promised, for the file check. */
  expected?: {
    duration: number;
    fps: number;
    width: number;
    height: number;
    audio: boolean;
  };
  verification?: {
    ok: boolean;
    duration?: number;
    expectedDuration?: number;
    streams: string[];
    width?: number;
    height?: number;
    issues: string[];
    checkedAt: string;
  };
  published?: { platforms: string[]; at: string; result: unknown }[];
}
export function exportTools(h: ToolHost): AgentTool[] {
  const g = "export";
  const records = () =>
    h.repo
      .list<ExportRecord>("export")
      .filter((r) => r.projectId === h.projectId);
  return [
    tool(
      g,
      "job",
      "export_video",
      "导出视频或音频：codec 为 h264（默认）、h265、vp9、prores、mp3、wav；transparent=true 时透明背景（vp9/prores）；可只导出 fromSeconds–toSeconds 一段。",
      s.object({
        codec: s.string(undefined, [
          "h264",
          "h265",
          "vp8",
          "vp9",
          "prores",
          "mp3",
          "wav",
        ]),
        crf: s.integer(),
        transparent: s.boolean(),
        fromSeconds: s.number(),
        toSeconds: s.number(),
        timelineId: s.string(),
      }),
      (a) => {
        const tl = timelineOf(h.project(), a.timelineId);
        return h.enqueue("export", "导出视频", {
          codec: a.codec ?? "h264",
          crf: a.crf ?? 20,
          transparent: a.transparent === true,
          timelineId: tl.id,
          ...(a.fromSeconds !== undefined || a.toSeconds !== undefined
            ? {
                range: [
                  Math.round((a.fromSeconds ?? 0) * tl.fps),
                  Math.round((a.toSeconds ?? 1e6) * tl.fps),
                ],
              }
            : {}),
        });
      },
    ),
    tool(
      g,
      "job",
      "export_clip",
      "单独导出一个片段（动画、标题、抠像人物等），默认透明背景 ProRes 4444。",
      s.object(
        {
          clipId: s.string(),
          codec: s.string(undefined, ["prores", "vp9", "h264"]),
          timelineId: s.string(),
        },
        ["clipId"],
      ),
      (a) =>
        h.enqueue("export-clip", "导出单个片段", {
          clipId: a.clipId,
          codec: a.codec ?? "prores",
          timelineId: timelineOf(h.project(), a.timelineId).id,
        }),
    ),
    tool(
      g,
      "job",
      "export_still",
      "把时间线某一帧导出为 PNG 或 JPEG 图片（封面、缩略图）。",
      s.object({
        ...timeArgs,
        format: s.string(undefined, ["png", "jpeg"]),
        timelineId: s.string(),
      }),
      (a) => {
        const tl = timelineOf(h.project(), a.timelineId);
        return h.enqueue("export-still", "导出静帧", {
          frame: toFrames(tl, a.frame, a.seconds) ?? 0,
          format: a.format ?? "png",
          timelineId: tl.id,
        });
      },
    ),
    tool(
      g,
      "job",
      "export_file",
      "导出工程交换文件：fcpxml、edl、srt、markdown（时间线表格）、capcut（剪映草稿）或 project（工程包）。",
      s.object(
        {
          format: s.string(undefined, [
            "fcpxml",
            "edl",
            "srt",
            "markdown",
            "capcut",
            "project",
          ]),
          timelineId: s.string(),
        },
        ["format"],
      ),
      async (a) => h.artifacts.export(h.projectId, a.format, a.timelineId),
    ),
    tool(
      g,
      "read",
      "export_history",
      "列出导出过的文件与校验结果。",
      s.object({}),
      () =>
        records()
          .slice(0, 30)
          .map(({ published, ...r }) => ({
            ...r,
            publishedTo: published?.flatMap((x) => x.platforms) ?? [],
          })),
    ),
    tool(
      g,
      "job",
      "verify_export",
      "用 ffprobe 检查导出文件：时长是否与时间线一致、音视频流与分辨率是否正确。",
      s.object({ exportId: s.string() }, ["exportId"]),
      async (a) => {
        const job = h.enqueue("verify-export", "导出校验", {
          exportId: a.exportId,
        }) as { jobId: string };
        const done = await h.waitJob(job.jobId, 60);
        return done?.status === "completed" ? done.result : job;
      },
    ),
    tool(
      g,
      "publish",
      "publish_video",
      "把导出的视频发布到你在 Upload-Post 绑定的平台。每次发布都需要你确认。",
      s.object(
        {
          exportId: s.string(),
          title: s.string(),
          description: s.string(),
          platforms: s.array(s.string("如 tiktok、youtube、instagram")),
          providerId: s.string(),
        },
        ["exportId", "title", "platforms"],
      ),
      (a) =>
        h.enqueue("publish", `发布「${a.title}」`, {
          ...a,
          providerId: h.provider("publish", a.providerId),
          confirmed: true,
        }),
    ),
    tool(
      g,
      "external",
      "upload_to_storage",
      "把素材或导出文件上传到你配置的 S3 兼容存储，返回限时访问地址（供需要公网地址的生成服务使用）。",
      s.object({
        assetId: s.string(),
        exportId: s.string(),
        providerId: s.string(),
        expiresHours: s.number(),
      }),
      (a) =>
        h.enqueue("storage-upload", "上传到云存储", {
          ...a,
          providerId: h.provider("storage", a.providerId),
        }),
    ),
  ];
}
