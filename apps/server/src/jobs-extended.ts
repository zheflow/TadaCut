import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  activeTimeline,
  productionPlan,
  recordProduction,
  stageNames,
  translateCaptions,
  type Asset,
  type Command,
  type Project,
  type ProductionStage,
  type Shot,
  type Timeline,
} from "@tadacut/domain";
import {
  completeChat,
  editImage,
  generateImage,
  generateReferenceVideo,
  generateSfx,
  generateTask,
  isolateVoice,
  publishVideo,
  s3Put,
  s3PresignGet,
  synthesizeSpeech,
  type GeneratedMedia,
  type ProviderContext,
} from "@tadacut/providers";
import {
  exportMedia,
  exportStill,
  singleClipTimeline,
} from "../../../packages/render/src/exporter";
import type { AgentService } from "./agent";
import type { ExportRecord } from "./agent-tools/export";
import { assetImages } from "./frames";
import type { JobQueue } from "./jobs";
import { mediaBinary, type MediaService } from "./media";
import { runProcess } from "./process";
import { fetchPublic } from "./public-web";
import type { Repository } from "./storage";

/** Last frame of a timeline, exclusive. */
export const timelineEnd = (t: Timeline) =>
  t.clips.reduce((end, c) => Math.max(end, c.start + c.duration), 0);
/** Image size for a generation, following the timeline's shape. */
export const imageSize = (t: Timeline) =>
  t.width > t.height * 1.15
    ? "1536x1024"
    : t.height > t.width * 1.15
      ? "1024x1536"
      : "1024x1024";
const types: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".cube": "text/plain",
};
export const mimeOf = (name: string) =>
  types[path.extname(name).toLowerCase()] ?? "application/octet-stream";
const extensionOf = (mime: string) =>
  Object.entries(types).find(([, m]) => m === mime.split(";")[0].trim())?.[0];
const message = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 500);
/** Does anything on the timeline make sound that an export should carry? */
const audible = (p: Project, t: Timeline) =>
  t.clips.some((c) => {
    const track = t.tracks.find((x) => x.id === c.trackId);
    return (
      !track?.muted &&
      !track?.hidden &&
      c.volume > 0 &&
      p.assets.find((a) => a.id === c.assetId)?.kind === "audio"
    );
  });
/** The file behind an export record, kept inside the exports folder. */
export function exportFile(artifactsDir: string, record: ExportRecord) {
  const rel = decodeURIComponent(record.url.replace(/^\/artifacts\//, "")),
    root = path.resolve(artifactsDir),
    file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) throw new Error("导出文件路径无效");
  if (!fs.existsSync(file)) throw new Error("导出文件已被删除，请重新导出");
  return file;
}
export function saveExport(
  repo: Repository,
  record: Omit<ExportRecord, "size" | "createdAt">,
  file: string,
) {
  const full: ExportRecord = {
    ...record,
    size: fs.statSync(file).size,
    createdAt: new Date().toISOString(),
  };
  repo.save("export", full);
  return full;
}
/** An image asset (or a video's first frame) as bytes a service accepts. */
async function imageOf(
  media: MediaService,
  asset: Asset,
  signal: AbortSignal,
  width = 1280,
) {
  if (asset.kind === "image") {
    const { default: sharp } = await import("sharp");
    return {
      bytes: new Uint8Array(
        await sharp(media.file(asset))
          .resize({ width, withoutEnlargement: true })
          .png()
          .toBuffer(),
      ),
      mime: "image/png",
    };
  }
  const [frame] = await assetImages(media, asset, [0], signal, width);
  return {
    bytes: new Uint8Array(Buffer.from(frame.image.split(",")[1], "base64")),
    mime: "image/jpeg",
  };
}
/** Reference images for consistent generations, small JPEGs. */
async function referenceImages(
  media: MediaService,
  p: Project,
  ids: string[],
  limit = 4,
) {
  const { default: sharp } = await import("sharp");
  const out: Uint8Array[] = [];
  for (const id of [...new Set(ids)].slice(0, limit)) {
    const asset = p.assets.find((a) => a.id === id && a.kind === "image");
    if (!asset) continue;
    try {
      out.push(
        new Uint8Array(
          await sharp(media.file(asset))
            .resize({ width: 1024, withoutEnlargement: true })
            .jpeg()
            .toBuffer(),
        ),
      );
    } catch {}
  }
  return out;
}
const capable = (ctx: ProviderContext, capability: string) => {
  if (!ctx.provider.capabilities.includes(capability as never))
    throw new Error(`「${ctx.provider.name}」没有启用这项能力`);
};
/** A voice ID the speech service understands, or its default voice. */
const voiceOf = (p: Project, shot: Shot) => {
  const voice = p.story.entities.find(
    (e) => shot.entityIds.includes(e.id) && e.kind === "character" && e.voice,
  )?.voice;
  return voice && /^[\w.-]{1,64}$/.test(voice) ? voice : "alloy";
};
const parseJsonArray = (text: string) => {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  const value = JSON.parse(
    cleaned.slice(cleaned.indexOf("["), cleaned.lastIndexOf("]") + 1),
  );
  if (!Array.isArray(value)) throw new Error("翻译结果不是列表");
  return value.map((x) => String(x ?? ""));
};

/**
 * Jobs behind the extended features: imports, scene and voice processing,
 * export records and checks, publishing and storage, motion baking and the
 * story production pipeline. Each job states what is missing (FFmpeg, a
 * provider capability, the user's confirmation) instead of pretending.
 */
export function registerExtendedJobs({
  repo,
  jobs,
  media,
  agent,
  publish,
  root,
  artifactsDir,
}: {
  repo: Repository;
  jobs: JobQueue;
  media: MediaService;
  agent: AgentService;
  publish(type: string, data: unknown): void;
  root: string;
  artifactsDir: string;
}) {
  const baseUrl = () => repo.settings("server-url", "http://127.0.0.1:4317"),
    mediaToken = () => repo.settings("media-token", "");
  const timelineFor = (p: Project, id?: string) =>
    p.timelines.find((t) => t.id === id) ?? activeTimeline(p);
  const commit = (projectId: string, label: string, commands: Command[]) => {
    const current = repo.get(projectId);
    const next = repo.commit(projectId, {
      requestId: crypto.randomUUID(),
      expectedRevision: current.revision,
      label,
      commands,
    }).project;
    publish("project", next);
    return next;
  };
  const expectedOf = (p: Project, t: Timeline, frames: number) => ({
    duration: frames / t.fps,
    fps: t.fps,
    width: t.width,
    height: t.height,
    audio: audible(p, t),
  });

  jobs.register("translate-captions", async ({ job, signal, progress }) => {
    const p = repo.get(job.projectId),
      t = timelineFor(p, job.input.timelineId),
      ids =
        Array.isArray(job.input.clipIds) && job.input.clipIds.length
          ? new Set<string>(job.input.clipIds)
          : undefined,
      language = String(job.input.language);
    const clips = t.clips
      .filter((c) => (ids ? ids.has(c.id) : Boolean(c.caption)))
      .filter((c) => (c.caption?.original ?? c.text ?? "").trim())
      .sort((a, b) => a.start - b.start);
    if (!clips.length) throw new Error("时间线上没有可翻译的字幕");
    const ctx = agent.context(job.input.providerId, signal),
      items: { clipId: string; text: string }[] = [];
    for (let i = 0; i < clips.length; i += 40) {
      const batch = clips.slice(i, i + 40);
      progress(
        5 + (i / clips.length) * 85,
        `翻译第 ${i + 1}–${i + batch.length} 条`,
      );
      let text = "";
      await completeChat(
        ctx,
        `把每条字幕翻译成${language}，口语、简洁，适合屏幕字幕；保留人名与专有名词。只输出 JSON 字符串数组，条数和顺序与输入完全一致，不加解释。`,
        [
          {
            role: "user",
            content: JSON.stringify(
              batch.map((c) => c.caption?.original ?? c.text ?? ""),
            ),
          },
        ],
        [],
        (d) => (text += d),
      );
      const lines = parseJsonArray(text);
      if (lines.length !== batch.length)
        throw new Error("模型返回的字幕条数不一致，请重试");
      batch.forEach((c, k) =>
        items.push({ clipId: c.id, text: lines[k].trim() }),
      );
    }
    const current = repo.get(p.id),
      live = timelineFor(current, t.id);
    const commands = translateCaptions(
      live,
      items.filter((x) => live.clips.some((c) => c.id === x.clipId)),
      language,
    );
    if (!commands.length) return { translated: 0 };
    const proposal = agent.proposal(
      p.id,
      `字幕翻译为${language}`,
      commands,
      current.revision,
    );
    return { translated: items.length, proposalId: proposal.id };
  });

  jobs.register("scene-detect", async ({ job, signal, progress }) => {
    const asset = repo
      .get(job.projectId)
      .assets.find((a) => a.id === job.input.assetId);
    if (!asset || asset.kind !== "video") throw new Error("请选择视频素材");
    const ffmpeg = mediaBinary("ffmpeg");
    if (!ffmpeg) throw new Error("场景检测需要 FFmpeg");
    const threshold = Math.max(
      0.05,
      Math.min(0.9, Number(job.input.threshold ?? 0.3)),
    );
    progress(10, "逐帧比较画面变化");
    const { stdout } = await runProcess(
      ffmpeg,
      [
        "-v",
        "error",
        "-i",
        media.file(asset),
        "-an",
        "-sn",
        "-dn",
        "-vf",
        `scale=320:-2,select='gt(scene,${threshold})',metadata=print:file=-`,
        "-f",
        "null",
        "-",
      ],
      signal,
      16 * 1024 * 1024,
    );
    const cuts: { seconds: number; score: number }[] = [];
    let at: number | undefined;
    for (const line of stdout.toString().split("\n")) {
      const time = /pts_time:([\d.]+)/.exec(line),
        score = /lavfi\.scene_score=([\d.]+)/.exec(line);
      if (time) at = Number(time[1]);
      else if (score && at !== undefined) {
        cuts.push({
          seconds: Math.round(at * 1000) / 1000,
          score: Number(score[1]),
        });
        at = undefined;
      }
    }
    // Flashes produce cuts a few frames apart; keep the strongest.
    const merged: typeof cuts = [];
    for (const cut of cuts) {
      const last = merged[merged.length - 1];
      if (last && cut.seconds - last.seconds < 0.4) {
        if (cut.score > last.score) merged[merged.length - 1] = cut;
      } else merged.push(cut);
    }
    // Where those cuts fall on the timeline, for clips that use this asset.
    const p = repo.get(job.projectId),
      t = activeTimeline(p),
      onTimeline = t.clips
        .filter((c) => c.assetId === asset.id)
        .flatMap((c) =>
          merged
            .map((cut) => (cut.seconds - c.sourceOffset) / c.speed)
            .filter((s) => s > 0 && s * t.fps < c.duration - 1)
            .map((s) => ({
              clipId: c.id,
              frame: c.start + Math.round(s * t.fps),
            })),
        );
    return {
      assetId: asset.id,
      threshold,
      cuts: merged.slice(0, 500),
      timeline: { timelineId: t.id, cuts: onTimeline.slice(0, 500) },
    };
  });

  jobs.register("voice-isolate", async ({ job, signal, progress }) => {
    const asset = repo
      .get(job.projectId)
      .assets.find((a) => a.id === job.input.assetId);
    if (!asset || (asset.kind !== "audio" && asset.kind !== "video"))
      throw new Error("请选择音频或视频素材");
    const ctx = agent.context(job.input.providerId, signal);
    capable(ctx, "voice-isolation");
    progress(10, "上传音轨");
    const audio = await media.audioUpload(asset, signal, 44100);
    progress(25, "分离人声");
    const generated = await isolateVoice(ctx, audio, (v) =>
      progress(25 + v * 0.6),
    );
    progress(90, "保存人声");
    const result = await media.generated(
      job.projectId,
      asset.name.replace(/\.[^.]+$/, "") + "-人声",
      generated,
      signal,
      {
        provider: ctx.provider.name,
        tags: ["人声分离"],
        source: { kind: "generated", name: ctx.provider.name },
      },
    );
    return { assetId: result.asset.id, url: result.asset.url };
  });

  jobs.register("url-import", async ({ job, signal, progress }) => {
    progress(5, "下载素材");
    const fetched = await fetchPublic(
      String(job.input.url),
      signal,
      1024 * 1024 * 1024,
    );
    const type = fetched.type.split(";")[0].trim().toLowerCase(),
      fromName = path.extname(new URL(fetched.url).pathname).toLowerCase(),
      ext =
        (types[fromName] ? fromName : undefined) ??
        extensionOf(type) ??
        (type.startsWith("video/")
          ? ".mp4"
          : type.startsWith("audio/")
            ? ".mp3"
            : undefined);
    if (!ext || /html|json|javascript/.test(type))
      throw new Error("这个地址不是可导入的图片、视频或音频文件");
    signal.throwIfAborted();
    progress(80, "登记素材");
    const file = path.join(media.dir, crypto.randomUUID() + ext);
    await fsp.writeFile(file, fetched.bytes, { flag: "wx" });
    const name =
      String(job.input.name ?? "").trim() ||
      decodeURIComponent(path.basename(new URL(fetched.url).pathname)) ||
      "网络素材";
    try {
      const result = await media.register(
        job.projectId,
        file,
        name.endsWith(ext) ? name : name + ext,
        types[ext] ?? type,
        {
          folder: job.input.sourceName
            ? String(job.input.sourceName)
            : "网络素材",
          tags: [String(job.input.sourceName ?? "网络素材")],
          source: {
            kind: job.input.license || job.input.sourceName ? "stock" : "url",
            name: String(
              job.input.sourceName ?? new URL(fetched.url).hostname,
            ).slice(0, 200),
            url: String(job.input.sourceUrl ?? fetched.url).slice(0, 2000),
            ...(job.input.license
              ? { license: String(job.input.license).slice(0, 300) }
              : {}),
            ...(job.input.author
              ? { author: String(job.input.author).slice(0, 200) }
              : {}),
          },
        },
      );
      return {
        assetId: result.asset.id,
        name: result.asset.name,
        kind: result.asset.kind,
      };
    } catch (e) {
      await fsp.unlink(file).catch(() => {});
      throw e;
    }
  });

  jobs.register("file-import", async ({ job, signal, progress }) => {
    const files = (job.input.files as string[]) ?? [],
      imported: { assetId: string; name: string }[] = [],
      failed: { file: string; error: string }[] = [];
    for (const [i, source] of files.entries()) {
      signal.throwIfAborted();
      progress(5 + (i / files.length) * 90, path.basename(source));
      const target = path.join(
        media.dir,
        crypto.randomUUID() + media.extension(source),
      );
      try {
        await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
        const result = await media.register(
          job.projectId,
          target,
          path.basename(source),
          mimeOf(source),
          { originalPath: source },
        );
        imported.push({ assetId: result.asset.id, name: result.asset.name });
      } catch (e) {
        await fsp.unlink(target).catch(() => {});
        failed.push({ file: path.basename(source), error: message(e) });
      }
    }
    return { imported, failed };
  });

  const clipExport = async (
    job: { id: string; projectId: string; input: Record<string, any> },
    signal: AbortSignal,
    progress: (value: number, label?: string) => void,
  ) => {
    const p = repo.get(job.projectId),
      t = timelineFor(p, job.input.timelineId),
      single = singleClipTimeline(t, String(job.input.clipId)),
      codec = String(job.input.codec ?? "prores"),
      output = path.join(artifactsDir, job.id);
    await fsp.mkdir(output, { recursive: true });
    const result = await exportMedia({
      project: { ...p, timelines: [...p.timelines, single] },
      timeline: single,
      codec,
      crf: 18,
      transparent: codec !== "h264",
      root,
      output,
      baseUrl: baseUrl(),
      mediaToken: mediaToken(),
      signal,
      progress,
    });
    return {
      p,
      t,
      single,
      codec,
      file: path.join(output, result.filename),
      filename: result.filename,
    };
  };
  jobs.register("export-clip", async ({ job, signal, progress }) => {
    const r = await clipExport(job, signal, progress);
    const record = saveExport(
      repo,
      {
        id: job.id,
        projectId: job.projectId,
        timelineId: r.t.id,
        kind: "clip",
        filename: r.filename,
        url: `/artifacts/${job.id}/${r.filename}`,
        codec: r.codec,
        expected: expectedOf(r.p, r.single, timelineEnd(r.single)),
      },
      r.file,
    );
    publish("exports", { projectId: job.projectId });
    return { exportId: record.id, url: record.url, filename: record.filename };
  });
  jobs.register("bake-motion", async ({ job, signal, progress }) => {
    const r = await clipExport(job, signal, progress);
    const clip = r.t.clips.find((c) => c.id === job.input.clipId)!,
      source = r.p.assets.find((a) => a.id === clip.assetId);
    progress(95, "登记为视频素材");
    const target = path.join(
      media.dir,
      crypto.randomUUID() + path.extname(r.filename),
    );
    await fsp.copyFile(r.file, target);
    const result = await media.register(
      job.projectId,
      target,
      `${source?.name ?? "动画"}-渲染${path.extname(r.filename)}`,
      mimeOf(r.filename),
      { tags: ["动画渲染", "透明背景"], folder: "动画渲染" },
    );
    return {
      assetId: result.asset.id,
      note: "已生成透明背景视频素材，可用 add_clip 替换或叠加原动画",
    };
  });
  jobs.register("export-still", async ({ job, signal, progress }) => {
    const p = repo.get(job.projectId),
      t = timelineFor(p, job.input.timelineId),
      output = path.join(artifactsDir, job.id);
    await fsp.mkdir(output, { recursive: true });
    progress(20, "渲染静帧");
    const format = job.input.format === "jpeg" ? "jpeg" : "png";
    const result = await exportStill({
      project: p,
      timeline: t,
      frame: Math.max(
        0,
        Math.min(Math.max(0, timelineEnd(t) - 1), Number(job.input.frame ?? 0)),
      ),
      root,
      output,
      baseUrl: baseUrl(),
      mediaToken: mediaToken(),
      format,
      signal,
    });
    const record = saveExport(
      repo,
      {
        id: job.id,
        projectId: p.id,
        timelineId: t.id,
        kind: "still",
        filename: result.filename,
        url: `/artifacts/${job.id}/${result.filename}`,
        codec: format,
        expected: {
          duration: 0,
          fps: t.fps,
          width: t.width,
          height: t.height,
          audio: false,
        },
      },
      path.join(output, result.filename),
    );
    publish("exports", { projectId: p.id });
    return { exportId: record.id, url: record.url, frame: result.frame };
  });

  jobs.register("verify-export", async ({ job, signal, progress }) => {
    const record = repo.record<ExportRecord>(
      "export",
      String(job.input.exportId),
    );
    if (!record || record.projectId !== job.projectId)
      throw new Error("导出记录不存在");
    const file = exportFile(artifactsDir, record),
      probe = mediaBinary("ffprobe");
    if (!probe) throw new Error("导出校验需要 FFprobe");
    progress(30, "读取文件信息");
    const data = JSON.parse(
      (
        await runProcess(
          probe,
          ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
          signal,
          4 * 1024 * 1024,
        )
      ).stdout.toString(),
    );
    const streams = (data.streams ?? []) as any[],
      video = streams.find((s) => s.codec_type === "video"),
      audio = streams.find((s) => s.codec_type === "audio"),
      duration = Number(
        data.format?.duration ?? video?.duration ?? audio?.duration,
      ),
      e = record.expected,
      issues: string[] = [];
    if (!fs.statSync(file).size) issues.push("文件为空");
    if (record.kind === "still") {
      if (!video) issues.push("无法读取图片");
    } else {
      if (!Number.isFinite(duration)) issues.push("无法读取时长");
      if (record.kind !== "audio" && !video) issues.push("没有视频流");
      if (record.kind === "audio" && !audio) issues.push("没有音频流");
    }
    if (e) {
      if (
        record.kind !== "still" &&
        Number.isFinite(duration) &&
        Math.abs(duration - e.duration) > Math.max(0.25, 2 / e.fps)
      )
        issues.push(
          `时长 ${duration.toFixed(2)} 秒，时间线为 ${e.duration.toFixed(2)} 秒`,
        );
      if (e.audio && record.kind === "video" && !audio)
        issues.push("时间线有声音，但文件没有音轨");
      if (
        video &&
        record.kind !== "audio" &&
        (video.width !== e.width || video.height !== e.height)
      )
        issues.push(
          `分辨率 ${video.width}×${video.height}，时间线为 ${e.width}×${e.height}`,
        );
    }
    const verification: NonNullable<ExportRecord["verification"]> = {
      ok: !issues.length,
      ...(Number.isFinite(duration) ? { duration } : {}),
      ...(e && record.kind !== "still" ? { expectedDuration: e.duration } : {}),
      streams: streams.map(
        (s) =>
          `${s.codec_type}:${s.codec_name}${s.width ? ` ${s.width}×${s.height}` : ""}${s.sample_rate ? ` ${s.sample_rate}Hz` : ""}`,
      ),
      ...(video ? { width: video.width, height: video.height } : {}),
      issues,
      checkedAt: new Date().toISOString(),
    };
    repo.save("export", { ...record, verification });
    publish("exports", { projectId: record.projectId });
    return verification;
  });

  jobs.register("publish", async ({ job, signal, progress }) => {
    // Publishing is public and cannot be taken back; it only runs on the user's confirmation.
    if (job.input.confirmed !== true) throw new Error("发布需要你在确认后进行");
    const record = repo.record<ExportRecord>(
      "export",
      String(job.input.exportId),
    );
    if (!record || record.projectId !== job.projectId)
      throw new Error("导出记录不存在");
    if (record.kind !== "video" && record.kind !== "clip")
      throw new Error("只能发布导出的视频");
    const file = exportFile(artifactsDir, record),
      size = fs.statSync(file).size;
    if (size > 2 * 1024 * 1024 * 1024)
      throw new Error("视频超过 2 GB，请压缩后再发布");
    const ctx = agent.context(String(job.input.providerId), signal);
    capable(ctx, "publish");
    progress(15, "上传视频");
    const platforms = (job.input.platforms as string[]).map(String);
    const result = await publishVideo(
      ctx,
      {
        bytes: new Uint8Array(await fsp.readFile(file)),
        name: record.filename,
        mime: mimeOf(record.filename),
      },
      {
        title: String(job.input.title),
        description: job.input.description,
        platforms,
      },
    );
    const latest = repo.record<ExportRecord>("export", record.id) ?? record;
    repo.save("export", {
      ...latest,
      published: [
        ...(latest.published ?? []),
        { platforms, at: new Date().toISOString(), result },
      ].slice(-20),
    });
    publish("exports", { projectId: record.projectId });
    return { published: platforms, result };
  });

  jobs.register("storage-upload", async ({ job, signal, progress }) => {
    let file: string, name: string;
    if (job.input.exportId) {
      const record = repo.record<ExportRecord>(
        "export",
        String(job.input.exportId),
      );
      if (!record || record.projectId !== job.projectId)
        throw new Error("导出记录不存在");
      file = exportFile(artifactsDir, record);
      name = record.filename;
    } else {
      const asset = repo
        .get(job.projectId)
        .assets.find((a) => a.id === job.input.assetId);
      if (!asset) throw new Error("请选择素材或导出文件");
      file = media.file(asset);
      name = asset.name;
    }
    if (fs.statSync(file).size > 2 * 1024 * 1024 * 1024)
      throw new Error("文件超过 2 GB");
    const ctx = agent.context(String(job.input.providerId), signal);
    capable(ctx, "storage");
    progress(20, "上传到云存储");
    const key = `${job.projectId}/${crypto.randomUUID()}${path.extname(file).toLowerCase()}`;
    const stored = await s3Put(
      ctx,
      key,
      new Uint8Array(await fsp.readFile(file)),
      mimeOf(file),
    );
    const hours = Math.max(
      1,
      Math.min(168, Number(job.input.expiresHours ?? 24)),
    );
    return {
      name,
      key: stored.key,
      url: s3PresignGet(ctx, key, hours * 3600),
      expiresAt: new Date(Date.now() + hours * 3600 * 1000).toISOString(),
    };
  });

  /** One storyboard output: a still, a video from the still, or the line read aloud. */
  const produceOne = async (
    ctx: ProviderContext,
    p: Project,
    shot: Shot,
    stage: ProductionStage,
    prompt: string,
    references: string[],
    signal: AbortSignal,
    onProgress: (value: number) => void,
  ): Promise<GeneratedMedia> => {
    if (stage === "frame") {
      capable(ctx, "image");
      return generateImage(
        ctx,
        prompt,
        imageSize(activeTimeline(p)),
        await referenceImages(media, p, references),
      );
    }
    if (stage === "voice") {
      capable(ctx, "speech");
      return synthesizeSpeech(ctx, shot.dialogue.trim(), voiceOf(p, shot));
    }
    const duration = Math.max(1, Math.round(shot.duration)),
      frame = p.assets.find((a) => a.id === shot.frameAssetId);
    if (frame && ctx.provider.capabilities.includes("ref-video"))
      return generateReferenceVideo(
        ctx,
        prompt,
        await imageOf(media, frame, signal),
        duration,
        onProgress,
      );
    if (ctx.provider.capabilities.includes("video"))
      return generateTask(ctx, "video", prompt, duration, onProgress);
    throw new Error(`「${ctx.provider.name}」没有启用视频或参考图生视频能力`);
  };
  jobs.register("produce", async ({ job, signal, progress }) => {
    const input = job.input as {
      stages: ProductionStage[];
      shotIds?: string[];
      providerIds: Partial<Record<ProductionStage, string>>;
      force?: boolean;
      assemble?: boolean;
    };
    const plan = productionPlan(repo.get(job.projectId), {
      stages: input.stages,
      shotIds: input.shotIds,
      providerIds: input.providerIds,
      force: input.force,
    });
    if (!plan.length)
      return { produced: [], failed: [], note: "没有需要生产的内容" };
    const produced: {
        shotId: string;
        number: number;
        stage: ProductionStage;
        assetId: string;
      }[] = [],
      failed: {
        shotId: string;
        number: number;
        stage: ProductionStage;
        error: string;
      }[] = [],
      blocked = new Set<string>();
    for (const [i, planned] of plan.entries()) {
      signal.throwIfAborted();
      // A shot whose still failed cannot make its video from it.
      if (planned.stage === "video" && blocked.has(planned.shotId)) continue;
      const p = repo.get(job.projectId),
        shot = p.story.shots.find((s) => s.id === planned.shotId);
      if (!shot) continue;
      // Prompt and references again from the latest project: a new still changes the video's inputs.
      const task = productionPlan(p, {
        stages: [planned.stage],
        shotIds: [shot.id],
        providerIds: input.providerIds,
        force: true,
      })[0];
      const providerId = input.providerIds[planned.stage];
      if (!task || !providerId) continue;
      const step = (v: number) =>
        progress(
          2 + ((i + Math.min(1, v / 100)) / plan.length) * 93,
          `镜头 ${shot.number} · ${stageNames[task.stage]}`,
        );
      step(0);
      try {
        const ctx = agent.context(providerId, signal);
        const generated = await produceOne(
          ctx,
          p,
          shot,
          task.stage,
          task.prompt,
          task.references,
          signal,
          step,
        );
        const result = await media.generated(
          p.id,
          `镜头${shot.number}-${stageNames[task.stage]}`,
          generated,
          signal,
          {
            provider: ctx.provider.name,
            description: task.prompt.slice(0, 2000),
            tags: ["AI 生成", "分镜生产", stageNames[task.stage]],
            folder: "分镜生产",
            source: { kind: "generated", name: ctx.provider.name },
          },
        );
        const live = repo.get(p.id).story.shots.find((s) => s.id === shot.id);
        if (!live) continue;
        commit(p.id, `生产镜头 ${shot.number} ${stageNames[task.stage]}`, [
          {
            type: "story.shot.upsert",
            shot: recordProduction(live, task.stage, {
              assetId: result.asset.id,
              provider: ctx.provider.name,
              prompt: task.prompt.slice(0, 4000),
              fingerprint: task.fingerprint,
              at: new Date().toISOString(),
            }),
          },
        ]);
        produced.push({
          shotId: shot.id,
          number: shot.number,
          stage: task.stage,
          assetId: result.asset.id,
        });
      } catch (e) {
        if (signal.aborted) throw e;
        failed.push({
          shotId: shot.id,
          number: shot.number,
          stage: task.stage,
          error: message(e),
        });
        if (task.stage === "frame") blocked.add(shot.id);
      }
    }
    let proposalId: string | undefined;
    if (input.assemble && produced.length) {
      const p = repo.get(job.projectId),
        t = activeTimeline(p),
        trackId = t.tracks.find((x) => x.kind === "video" && !x.locked)?.id;
      if (trackId)
        proposalId = agent.proposal(p.id, "把生产好的镜头排到时间线", [
          {
            type: "story.sync",
            timelineId: t.id,
            direction: "story-to-timeline",
            trackId,
            force: false,
          },
        ]).id;
    }
    if (!produced.length && failed.length)
      throw new Error(`生产未完成：${failed[0].error}`);
    return { produced, failed, ...(proposalId ? { proposalId } : {}) };
  });

  jobs.register("turnaround", async ({ job, signal, progress }) => {
    const p = repo.get(job.projectId),
      entity = p.story.entities.find((e) => e.id === job.input.entityId);
    if (!entity) throw new Error("角色设定不存在");
    const ctx = agent.context(String(job.input.providerId), signal);
    capable(ctx, "image");
    const references = await referenceImages(
      media,
      p,
      [entity.views.front, ...entity.referenceAssetIds].filter(
        (x): x is string => Boolean(x),
      ),
      3,
    );
    const views = [
      ["front", "正面"],
      ["side", "侧面"],
      ["back", "背面"],
    ] as const;
    const made: Partial<Record<(typeof views)[number][0], string>> = {};
    for (const [i, [view, name]] of views.entries()) {
      progress(8 + i * 30, `生成${name}`);
      const prompt = [
        `角色设定图：${entity.name}，${name}全身像。`,
        entity.traits,
        entity.description,
        "同一人物、同一服装与配色，自然站姿，纯浅灰背景，均匀柔光，画面中没有文字。",
      ]
        .filter(Boolean)
        .join("\n");
      const result = await media.generated(
        p.id,
        `${entity.name}-${name}`,
        await generateImage(ctx, prompt, "1024x1536", references),
        signal,
        {
          provider: ctx.provider.name,
          description: prompt,
          tags: ["AI 生成", "三视图", entity.name],
          folder: "设定图",
          source: { kind: "generated", name: ctx.provider.name },
        },
      );
      made[view] = result.asset.id;
      // The side and back follow the front just made.
      if (i === 0)
        references.unshift(
          ...(await referenceImages(
            media,
            repo.get(p.id),
            [result.asset.id],
            1,
          )),
        );
    }
    const live = repo.get(p.id).story.entities.find((e) => e.id === entity.id);
    if (!live) return { ...made, note: "设定已删除，图片保留在素材库" };
    commit(p.id, `生成「${live.name}」三视图候选`, [
      {
        type: "story.entity.upsert",
        entity: {
          ...live,
          candidateAssetIds: [
            ...new Set([...live.candidateAssetIds, ...Object.values(made)]),
          ].slice(-30),
        },
      },
    ]);
    return {
      ...made,
      note: "已加入候选，用 choose_candidate 以 front/side/back 选定",
    };
  });

  jobs.register("cover", async ({ job, signal, progress }) => {
    const p = repo.get(job.projectId),
      t = activeTimeline(p),
      ctx = agent.context(String(job.input.providerId), signal);
    capable(ctx, "image");
    const d = p.story.development,
      brand = p.styles.brand,
      title = String(job.input.title ?? "").trim();
    const prompt = [
      `视频封面：${String(job.input.prompt ?? "").trim() || p.story.logline || p.name}`,
      d.genre || d.tone
        ? `风格：${[d.genre, d.tone].filter(Boolean).join("，")}`
        : "",
      brand.colors.length ? `主色：${brand.colors.slice(0, 3).join("、")}` : "",
      title
        ? `画面中有醒目的标题文字「${title}」，字体清晰易读，放在不遮挡主体的位置。`
        : "构图为标题留出干净的区域。",
      "主体清晰、高对比、有冲击力，适合在视频平台的缩略图尺寸下辨认。",
    ]
      .filter(Boolean)
      .join("\n");
    progress(15, "生成封面");
    const references = await referenceImages(
      media,
      p,
      p.story.entities
        .filter((e) => e.confirmed)
        .flatMap((e) =>
          [e.views.front, ...e.referenceAssetIds].filter((x): x is string =>
            Boolean(x),
          ),
        ),
      3,
    );
    const result = await media.generated(
      p.id,
      title ? `封面-${title}` : "封面",
      await generateImage(
        ctx,
        prompt,
        String(job.input.size ?? imageSize(t)),
        references,
      ),
      signal,
      {
        provider: ctx.provider.name,
        description: prompt,
        tags: ["AI 生成", "封面"],
        folder: "封面",
        source: { kind: "generated", name: ctx.provider.name },
      },
    );
    return { assetId: result.asset.id, url: result.asset.url };
  });
}

/**
 * The newer generation capabilities, used by the generate job: sound
 * effects, editing an image by instruction and video from a reference image.
 */
export async function generateMore(
  media: MediaService,
  ctx: ProviderContext,
  p: Project,
  input: Record<string, any>,
  signal: AbortSignal,
  progress: (value: number) => void,
): Promise<GeneratedMedia | null> {
  const prompt = String(input.prompt);
  switch (input.capability) {
    case "sfx":
      return generateSfx(
        ctx,
        prompt,
        input.duration ? Number(input.duration) : undefined,
        progress,
      );
    case "image-edit": {
      const asset = p.assets.find((a) => a.id === input.assetId);
      if (!asset || (asset.kind !== "image" && asset.kind !== "video"))
        throw new Error("请选择要修改的图片");
      return editImage(
        ctx,
        prompt,
        await imageOf(media, asset, signal, 1536),
        progress,
      );
    }
    case "ref-video": {
      const shot = p.story.shots.find((s) => s.id === input.shotId),
        asset = p.assets.find(
          (a) => a.id === (input.assetId ?? shot?.frameAssetId),
        );
      if (!asset || (asset.kind !== "image" && asset.kind !== "video"))
        throw new Error("请提供参考图（assetId，或已有分镜图的镜头）");
      return generateReferenceVideo(
        ctx,
        prompt,
        await imageOf(media, asset, signal),
        Math.max(1, Math.round(Number(input.duration ?? shot?.duration ?? 5))),
        progress,
      );
    }
  }
  return null;
}
