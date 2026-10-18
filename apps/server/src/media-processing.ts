import { colorTags, conversionFilter } from "./color-export";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import {
  maskSvg,
  assetSchema,
  clipSchema,
  colorConversionCube,
  commandSchema,
  dependencyValue,
  mediaProcessRequestSchema,
  captionPresets,
  newTrack,
  processedClipPatch,
  processingFeatures,
  processingSourceKinds,
  trackRegion,
  type Asset,
  type Clip,
  type Command,
  type MediaOperation,
  type Project,
  type Timeline,
} from "@tadacut/domain";
import {
  transcribe,
  isolateVoice,
  processAdvancedMedia,
  type AdvancedMediaCapability,
  type ProviderContext,
  headers,
} from "@tadacut/providers";
import {
  exportMedia,
  singleClipTimeline,
} from "../../../packages/render/src/exporter";
import { type JobQueue, type JobContext } from "./jobs";
import type { Job, Repository } from "./storage";
import type { AgentService } from "./agent";
import { MediaService, mediaBinary } from "./media";
import { runProcess } from "./process";
import { processingFilterGraph, tempoFilters } from "./media-filters";
import { fetchPublic } from "./public-web";

type Dependencies = Extract<
  Command,
  { type: "project.assert" }
>["dependencies"];
interface Snapshot {
  project: Project;
  asset: Asset;
  clip?: Clip;
  timeline: Timeline;
  dependencies: Dependencies;
}
export interface ProcessResult {
  label: string;
  commands: Command[];
  assetId?: string;
  url?: string;
  previewUrl?: string;
  warnings: string[];
  cached?: boolean;
}
export function prepareMediaProcess(
  repo: Repository,
  projectId: string,
  raw: unknown,
  trustedProject?: Project,
) {
  const input = mediaProcessRequestSchema.parse(raw),
    project = trustedProject
      ? structuredClone(trustedProject)
      : repo.get(projectId);
  if (project.id !== projectId) throw new Error("处理快照不属于当前项目");
  if (project.revision !== input.expectedRevision)
    throw new Error("项目已改变，请刷新后再处理");
  const timeline = project.timelines.find(
    (t) => t.id === (input.timelineId ?? project.activeTimelineId),
  );
  if (!timeline) throw new Error("时间线不存在");
  const clip = input.clipId
    ? timeline.clips.find((c) => c.id === input.clipId)
    : undefined;
  if (input.clipId && !clip) throw new Error("片段不存在");
  if (clip && timeline.tracks.find((t) => t.id === clip.trackId)?.locked)
    throw new Error("请先解锁轨道");
  const asset = project.assets.find(
    (a) => a.id === (clip?.assetId ?? input.assetId),
  );
  if (
    !asset ||
    !processingSourceKinds(input.operation.type).includes(asset.kind)
  )
    throw new Error("此功能不支持当前素材类型，请选择适用的片段或素材");
  const dependencies: Dependencies = [];
  const dependency = (
    kind: Dependencies[number]["kind"],
    id: string,
    tid?: string,
  ) => {
    const dep = { kind, id, ...(tid ? { timelineId: tid } : {}) };
    dependencies.push({ ...dep, value: dependencyValue(project, dep) });
  };
  dependency("asset", asset.id);
  dependency("timeline", timeline.id);
  if (clip) dependency("clip", clip.id, timeline.id);
  if (input.operation.type === "prerender") {
    if (!clip || asset.kind === "audio") throw new Error("预渲染需要画面片段");
    for (const a of project.assets)
      if (a.id !== asset.id) dependency("asset", a.id);
    for (const t of project.timelines) dependency("timeline-content", t.id);
    if (dependencies.length > 500)
      throw new Error("工程过大，请把待缓存片段放入独立工程后处理");
  }
  for (const key of [
    "audioAssetId",
    "maskAssetId",
    "backgroundAssetId",
  ] as const)
    if (key in input.operation) {
      const id = (input.operation as unknown as Record<string, string>)[key];
      if (id) {
        if (!project.assets.some((a) => a.id === id))
          throw new Error("关联素材不存在");
        dependency("asset", id);
      }
    }
  if (input.operation.type === "inpaint") {
    const maskId = input.operation.maskId;
    if (
      !input.operation.maskAssetId &&
      !clip?.advanced?.masks?.some((m) => m.id === maskId)
    )
      throw new Error("请选择消除蒙版文件或原片段上的蒙版");
  }
  if (
    input.operation.type === "track" &&
    input.operation.targetClipId &&
    input.operation.targetClipId !== clip?.id
  ) {
    const targetId = input.operation.targetClipId;
    if (!timeline.clips.some((c) => c.id === targetId))
      throw new Error("跟踪目标片段不存在");
    dependency("clip", input.operation.targetClipId, timeline.id);
  }
  return {
    ...input,
    snapshot: {
      project,
      asset,
      clip,
      timeline,
      dependencies,
    } satisfies Snapshot,
  };
}
export function processResultCommands(
  repo: Repository,
  projectId: string,
  jobId: string,
): ProcessResult {
  const job = repo.record<Job>("job", jobId);
  if (
    !job ||
    job.projectId !== projectId ||
    job.kind !== "process-media" ||
    job.status !== "completed"
  )
    throw new Error("处理结果尚未完成或不属于这个项目");
  const result = job.result as ProcessResult;
  if (!result?.commands?.length) throw new Error("任务没有可应用的结果");
  const commands = result.commands.map((c) => commandSchema.parse(c));
  return { ...result, commands };
}
const digest = (bytes: Buffer | string) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
const videoEncoding = () =>
  process.platform === "darwin"
    ? [
        "-c:v",
        "h264_videotoolbox",
        "-allow_sw",
        "1",
        "-b:v",
        "12M",
        "-pix_fmt",
        "yuv420p",
      ]
    : [
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
      ];
async function probe(file: string, signal: AbortSignal) {
  const bin = mediaBinary("ffprobe");
  if (!bin) throw new Error("FFprobe 不可用");
  return JSON.parse(
    (
      await runProcess(
        bin,
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
        signal,
        4 * 1024 * 1024,
      )
    ).stdout.toString(),
  ) as {
    streams: { codec_type: string; width?: number; height?: number }[];
    format: { duration?: string };
  };
}
async function fileHash(file: string) {
  return digest(await fs.readFile(file));
}
function requireBinary() {
  const bin = mediaBinary("ffmpeg");
  if (!bin) throw new Error("本机 FFmpeg 不可用，请安装完整版本");
  return bin;
}
async function dataUri(file: string, mime: string) {
  if ((await fs.stat(file)).size > 128 * 1024 * 1024)
    throw new Error("模型上传限 128 MB，请缩短片段或先创建代理素材");
  return `data:${mime};base64,${(await fs.readFile(file)).toString("base64")}`;
}
async function download(
  url: string,
  file: string,
  signal: AbortSignal,
  context?: ProviderContext,
) {
  const target = new URL(url);
  if (
    context &&
    target.origin === new URL(context.provider.baseUrl).origin &&
    !target.username &&
    !target.password
  ) {
    const response = await (context.fetcher ?? fetch)(target, {
      signal,
      headers: headers(context),
      redirect: "error",
    });
    if (!response.ok || !response.body) throw new Error("处理结果下载失败");
    const reader = response.body.getReader(),
      parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 512 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("处理结果过大");
      }
      parts.push(value);
    }
    if (!size) throw new Error("处理结果为空");
    await fs.writeFile(file, Buffer.concat(parts));
    return;
  }
  const response = await fetchPublic(url, signal, 512 * 1024 * 1024);
  if (!response.bytes.length) throw new Error("处理结果为空");
  await fs.writeFile(file, response.bytes);
}
const sourceMime = (asset: Asset) =>
  asset.mime ??
  {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  }[path.extname(asset.url).toLowerCase()] ??
  "application/octet-stream";

export function registerMediaProcessing(ctx: {
  repo: Repository;
  jobs: JobQueue;
  media: MediaService;
  agent: AgentService;
  root: string;
}) {
  const { repo, jobs, media, agent, root } = ctx;
  jobs.register(
    "process-media",
    async (jobCtx) => processMedia(ctx, jobCtx),
    (pid, input, trustedProject) =>
      prepareMediaProcess(repo, pid, input, trustedProject),
  );
}
async function processMedia(
  ctx: {
    repo: Repository;
    media: MediaService;
    agent: AgentService;
    root: string;
  },
  { job, signal, progress }: JobContext,
): Promise<ProcessResult> {
  const { repo, media, agent, root } = ctx;
  const snapshot = job.input.snapshot as Snapshot,
    { asset, clip, timeline, project, dependencies } = snapshot;
  const operation = job.input.operation as MediaOperation;
  const feature = processingFeatures.find((f) => f.type === operation.type)!;
  const warnings: string[] = [];
  if (operation.type === "prerender")
    return prerenderCandidate(ctx, snapshot, { job, signal, progress });
  const source = media.file(asset),
    binary = requireBinary();
  const sourceHash = await fileHash(source);
  if (asset.hash && sourceHash !== asset.hash)
    throw new Error("素材文件内容已改变，请重新关联后处理");
  const full: Awaited<ReturnType<typeof probe>> =
    asset.kind === "image"
      ? {
          streams: [
            { codec_type: "video", width: asset.width, height: asset.height },
          ],
          format: {},
        }
      : await probe(source, signal);
  const hasVideo = full.streams.some((s) => s.codec_type === "video"),
    hasAudio = full.streams.some((s) => s.codec_type === "audio");
  const fullDuration =
    Number(full.format.duration) ||
    asset.duration ||
    (clip && clip.duration / timeline.fps) ||
    0;
  if (
    !hasVideo &&
    operation.type !== "voice" &&
    operation.type !== "reverse" &&
    operation.type !== "speed-curve" &&
    operation.type !== "proxy" &&
    operation.type !== "lyrics"
  )
    throw new Error("这项操作需要画面素材");
  if (operation.type === "voice" && !hasAudio)
    throw new Error("素材中没有音轨");
  if (
    ["track", "reverse", "speed-curve", "interpolate", "stabilize"].includes(
      operation.type,
    ) &&
    asset.kind === "image"
  )
    throw new Error("这项操作需要有时长的视频");
  if (operation.type === "avatar" && asset.kind !== "image")
    throw new Error("数字人请选择一张人物图片");
  if (
    operation.type !== "avatar" &&
    operation.type !== "freeze" &&
    fullDuration <= 0
  )
    throw new Error("无法读取素材时长");
  const work = await fs.mkdtemp(path.join(media.dir, "processing-"));
  const initialDuration =
    operation.type === "proxy"
      ? fullDuration
      : clip
        ? clip.duration / timeline.fps
        : fullDuration;
  if (initialDuration > 1800) {
    await fs.rm(work, { recursive: true, force: true });
    throw new Error("单次处理限 30 分钟，请先分段");
  }
  const key = digest(
    JSON.stringify([
      "media-v2",
      sourceHash,
      clip,
      operation,
      timeline.fps,
      timeline.width,
      timeline.height,
    ]),
  );
  const extension = !hasVideo
    ? "wav"
    : operation.type === "color-convert"
      ? "mov"
      : operation.type === "remove-background"
        ? "webm"
        : "mp4";
  let output = path.join(media.dir, `${job.id}.${extension}`);
  const cache = repo.record<{
    id: string;
    file: string;
    hash: string;
    info: Partial<Asset>;
  }>("media-cache", key);
  const cacheFile =
    cache && /^[a-zA-Z0-9._-]+$/.test(cache.file)
      ? path.join(media.dir, cache.file)
      : undefined;
  const cached =
    cacheFile &&
    (await fs.stat(cacheFile).then(
      () => true,
      () => false,
    )) &&
    (await fileHash(cacheFile)) === cache!.hash;
  if (cached) output = cacheFile!;
  try {
    progress(3, "准备源媒体");
    let base = source;
    if (asset.kind === "image") {
      base = path.join(work, "source.png");
      await sharp(source).png().toFile(base);
    }
    if (
      !cached &&
      clip &&
      operation.type !== "proxy" &&
      operation.type !== "color-convert" &&
      asset.kind !== "image"
    ) {
      base = path.join(work, hasVideo ? "segment.mp4" : "segment.wav");
      await runProcess(
        binary,
        [
          "-v",
          "error",
          "-y",
          "-ss",
          String(clip.sourceOffset),
          "-t",
          String(initialDuration * clip.speed),
          "-i",
          source,
          ...(hasVideo
            ? [
                "-vf",
                `setpts=(PTS-STARTPTS)/${clip.speed},fps=${timeline.fps}`,
                ...videoEncoding(),
              ]
            : ["-vn"]),
          ...(hasAudio
            ? [
                "-af",
                tempoFilters(clip.speed),
                "-c:a",
                hasVideo ? "aac" : "pcm_s16le",
              ]
            : ["-an"]),
          base,
        ],
        signal,
      );
    }
    if (operation.type === "lyrics") {
      if (!hasAudio) throw new Error("素材没有音轨，无法识别歌词");
      const wav = path.join(work, "lyrics.wav");
      await runProcess(
        binary,
        [
          "-v",
          "error",
          "-y",
          "-i",
          base,
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          wav,
        ],
        signal,
      );
      let upload = {
        bytes: new Uint8Array(await fs.readFile(wav)),
        name: "lyrics.wav",
        mime: "audio/wav",
      };
      if (operation.isolationProviderId) {
        progress(15, "分离演唱人声");
        const isolated = await isolateVoice(
          agent.context(operation.isolationProviderId, signal),
          upload,
          progress,
        );
        if (isolated.bytes)
          upload = {
            bytes: new Uint8Array(isolated.bytes),
            name: "vocals.wav",
            mime: isolated.mime,
          };
        else if (isolated.url) {
          const vocal = path.join(work, "vocals.wav");
          await download(
            isolated.url,
            vocal,
            signal,
            agent.context(operation.isolationProviderId, signal),
          );
          upload = {
            bytes: new Uint8Array(await fs.readFile(vocal)),
            name: "vocals.wav",
            mime: isolated.mime,
          };
        }
      }
      progress(40, "识别歌词与词时间");
      const result = await transcribe(
        agent.context(operation.providerId, signal),
        upload,
        {
          prompt:
            "Transcribe the sung lyrics accurately. Keep repetitions and the original language. Do not describe the music.",
        },
      );
      const words = z
        .array(
          z
            .object({
              word: z.string(),
              start: z.number().nonnegative(),
              end: z.number().nonnegative(),
            })
            .refine((w) => w.end > w.start),
        )
        .min(1)
        .parse(result.words);
      const transcript = {
        id: crypto.randomUUID(),
        assetId: asset.id,
        language: result.language ?? "auto",
        words: words.map((w, i) => ({
          id: `${job.id}-${i}`,
          text: w.word,
          start: (clip?.sourceOffset ?? 0) + w.start * (clip?.speed ?? 1),
          end: (clip?.sourceOffset ?? 0) + w.end * (clip?.speed ?? 1),
          speaker: "演唱",
          deleted: false,
        })),
      };
      const lyricAsset = assetSchema.parse({
        id: crypto.randomUUID(),
        name: "歌词 · " + asset.name,
        kind: "text",
        text: words.map((w) => w.word).join(" "),
        folder: "歌词",
        createdAt: new Date().toISOString(),
      });
      const track = {
          ...newTrack(timeline, "text", crypto.randomUUID()),
          name: "识别歌词",
        },
        style =
          project.styles.captions.find((s) => s.id === operation.styleId) ??
          captionPresets.find((s) => s.id === operation.styleId) ??
          captionPresets.find((s) => s.id === "karaoke")!;
      const groups: (typeof words)[] = [];
      let group: typeof words = [];
      for (const word of words) {
        if (
          group.length &&
          (word.start - group.at(-1)!.end > 0.65 ||
            group.map((w) => w.word).join("").length >= 20)
        ) {
          groups.push(group);
          group = [];
        }
        group.push(word);
      }
      if (group.length) groups.push(group);
      const commands: Command[] = [
        { type: "project.assert", dependencies },
        { type: "transcript.set", transcript },
        { type: "asset.add", asset: lyricAsset },
        { type: "track.add", timelineId: timeline.id, track },
      ];
      for (const g of groups) {
        const start = Math.round(g[0].start * timeline.fps),
          end = Math.max(start + 1, Math.ceil(g.at(-1)!.end * timeline.fps));
        const text = g
          .map((w) => w.word)
          .join(result.language === "zh" ? "" : " ");
        commands.push({
          type: "clip.add",
          timelineId: timeline.id,
          clip: clipSchema.parse({
            id: crypto.randomUUID(),
            assetId: lyricAsset.id,
            trackId: track.id,
            start: (clip?.start ?? 0) + start,
            duration: end - start,
            name: text.slice(0, 40),
            text,
            textStyle: style.textStyle,
            caption: {
              styleId: style.id,
              animation: style.animation,
              highlight: style.highlight,
              words: g.map((w) => ({
                text: w.word,
                start: Math.max(0, Math.round(w.start * timeline.fps) - start),
                end: Math.min(
                  end - start,
                  Math.ceil(w.end * timeline.fps) - start,
                ),
              })),
            },
          }),
        });
      }
      return {
        label: "识别歌词",
        commands,
        warnings: ["歌词识别结果可逐词修正；伴奏较强时建议启用人声分离"],
      };
    }
    if (operation.type === "track") {
      const width = 320,
        height = Math.max(
          16,
          Math.round(((asset.height ?? 1080) / (asset.width ?? 1920)) * width),
        );
      const count = Math.ceil(initialDuration * operation.sampleFps);
      if (width * height * count > 160 * 1024 * 1024)
        throw new Error("跟踪范围过长，请缩短片段或降低采样率");
      const decoded = await runProcess(
        binary,
        [
          "-v",
          "error",
          "-i",
          base,
          "-vf",
          `fps=${operation.sampleFps},scale=${width}:${height}`,
          "-an",
          "-pix_fmt",
          "gray",
          "-f",
          "rawvideo",
          "pipe:1",
        ],
        signal,
        160 * 1024 * 1024,
      );
      const size = width * height,
        frames = Math.floor(decoded.stdout.length / size),
        r = operation.region;
      if (frames < 2) throw new Error("跟踪至少需要两帧");
      let corners: [number, number][] = [
        [r.x * width, r.y * height],
        [(r.x + r.width) * width, r.y * height],
        [(r.x + r.width) * width, (r.y + r.height) * height],
        [r.x * width, (r.y + r.height) * height],
      ];
      const samples: NonNullable<
        NonNullable<Clip["advanced"]>["tracking"]
      >["samples"] = [];
      for (let i = 0; i < frames; i++) {
        signal.throwIfAborted();
        let confidence = 1;
        if (i) {
          const found = trackRegion(
            {
              pixels: decoded.stdout.subarray((i - 1) * size, i * size),
              width,
              height,
            },
            {
              pixels: decoded.stdout.subarray(i * size, (i + 1) * size),
              width,
              height,
            },
            corners,
            operation.mode,
          );
          corners = found.corners;
          confidence = found.confidence;
        }
        samples.push({
          frame: Math.round((i / operation.sampleFps) * timeline.fps),
          corners: corners.map(([x, y]) => [
            x / width,
            y / height,
          ]) as (typeof samples)[number]["corners"],
          confidence,
        });
        if (i % 8 === 0) {
          progress(10 + (80 * i) / frames, "跟踪画面");
          await new Promise<void>((r) => setImmediate(r));
        }
      }
      const target = timeline.clips.find(
        (c) => c.id === (operation.targetClipId ?? clip?.id),
      );
      if (!target) throw new Error("请选择要接收跟踪结果的片段");
      const advanced = structuredClone(target.advanced ?? {}),
        offset = (clip?.start ?? 0) - target.start;
      const mapped = samples
        .map((s) => ({ ...s, frame: s.frame + offset }))
        .filter((s) => s.frame >= 0 && s.frame < target.duration);
      if (!mapped.length) throw new Error("目标片段与跟踪范围没有时间重叠");
      if (operation.maskId) {
        const mask = advanced.masks?.find((m) => m.id === operation.maskId);
        if (!mask) throw new Error("目标蒙版不存在");
        const first = mapped[0].corners;
        const center = (c: typeof first) =>
          c.reduce(
            (s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4] as [number, number],
            [0, 0],
          );
        const origin = center(first);
        mask.keys = mapped.map((s) => {
          const v = center(s.corners);
          return {
            frame: s.frame,
            x: mask.x + v[0] - origin[0],
            y: mask.y + v[1] - origin[1],
            width: mask.width,
            height: mask.height,
            rotation: mask.rotation,
            feather: mask.feather,
          };
        });
      } else advanced.tracking = { mode: operation.mode, samples: mapped };
      if (samples.some((s) => s.confidence < 0.45))
        warnings.push(
          "部分帧的跟踪置信度较低，已保留上一位置，请在预览中检查并修正",
        );
      return {
        label: feature.name,
        warnings,
        commands: [
          { type: "project.assert", dependencies },
          {
            type: "clip.update",
            timelineId: timeline.id,
            clipId: target.id,
            patch: { advanced },
          },
        ],
      };
    }
    if (!cached) {
      progress(15, feature.name);
      if (operation.type === "freeze") {
        if (operation.at >= initialDuration && asset.kind !== "image")
          throw new Error("定格位置超出片段");
        const image = path.join(work, "freeze.png");
        await runProcess(
          binary,
          [
            "-v",
            "error",
            "-y",
            ...(asset.kind === "image" ? [] : ["-ss", String(operation.at)]),
            "-i",
            base,
            "-frames:v",
            "1",
            image,
          ],
          signal,
        );
        await runProcess(
          binary,
          [
            "-v",
            "error",
            "-y",
            "-loop",
            "1",
            "-i",
            image,
            "-t",
            String(operation.seconds),
            "-r",
            String(timeline.fps),
            ...videoEncoding(),
            "-an",
            output,
          ],
          signal,
        );
      } else if (operation.type === "color-convert") {
        const cube = path.join(work, "convert.cube");
        await fs.writeFile(
          cube,
          colorConversionCube(
            operation.input,
            operation.output,
            operation.peakNits,
          ),
        );
        const hdr = operation.output.startsWith("rec2020"),
          matrix = hdr ? "bt2020nc" : "bt709",
          trc =
            operation.output === "rec2020-pq"
              ? "smpte2084"
              : operation.output === "rec2020-hlg"
                ? "arib-std-b67"
                : operation.output === "srgb"
                  ? "iec61966-2-1"
                  : "bt709";
        const escaped = cube
          .replace(/\\/g, "\\\\")
          .replace(/:/g, "\\:")
          .replace(/'/g, "\\'");
        await runProcess(
          binary,
          [
            "-v",
            "error",
            "-y",
            ...(clip
              ? [
                  "-ss",
                  String(clip.sourceOffset),
                  "-t",
                  String(initialDuration * clip.speed),
                ]
              : []),
            "-i",
            base,
            "-vf",
            `setpts=(PTS-STARTPTS)/${clip?.speed ?? 1},fps=${timeline.fps},scale=in_color_matrix=${operation.input.startsWith("rec2020") ? "bt2020" : "bt709"}:out_range=full,format=gbrpf32le,lut3d=file='${escaped}':interp=tetrahedral,scale=out_color_matrix=${hdr ? "bt2020" : "bt709"}:out_range=tv,format=yuv444p10le,setparams=color_primaries=${hdr ? "bt2020" : "bt709"}:color_trc=${trc}:colorspace=${matrix}`,
            "-c:v",
            "prores_ks",
            "-profile:v",
            "3",
            "-color_primaries",
            hdr ? "bt2020" : "bt709",
            "-color_trc",
            trc,
            "-colorspace",
            matrix,
            ...(hasAudio
              ? ["-af", tempoFilters(clip?.speed ?? 1), "-c:a", "pcm_s16le"]
              : []),
            output,
          ],
          signal,
        );
      } else if ("providerId" in operation) {
        const capability = (feature as { capability?: string })
          .capability as AdvancedMediaCapability;
        const provider = agent.context(operation.providerId, signal);
        if (
          operation.type === "remove-background" &&
          (initialDuration >= 30 ||
            (asset.width ?? 0) >= 4000 ||
            (asset.height ?? 0) >= 4000)
        )
          throw new Error("当前抠像服务要求片段短于 30 秒且画面小于 4000×4000");
        const extra = async (id: string, audio = false) => {
          const a = project.assets.find((a) => a.id === id)!;
          if (audio) {
            const upload = await media.audioUpload(a, signal);
            if (upload.bytes.length > 128 * 1024 * 1024)
              throw new Error("配音上传过大，请缩短素材");
            return `data:${upload.mime};base64,${Buffer.from(upload.bytes).toString("base64")}`;
          }
          return dataUri(media.file(a), sourceMime(a));
        };
        let mask: string | undefined;
        if (operation.type === "inpaint") {
          const m = project.assets.find((a) => a.id === operation.maskAssetId);
          if (operation.maskId && clip) {
            const selected = clip.advanced?.masks?.find(
              (m) => m.id === operation.maskId,
            );
            if (!selected) throw new Error("片段蒙版不存在");
            const w = Math.round(asset.width ?? 1280),
              h = Math.round(asset.height ?? 720),
              frames = Math.ceil(initialDuration * timeline.fps);
            if (frames > 3600)
              throw new Error("消除蒙版一次最多 3600 帧，请先分段");
            for (let frame = 0; frame < frames; frame++) {
              signal.throwIfAborted();
              await sharp(
                Buffer.from(
                  maskSvg(
                    [{ ...selected, operation: "add", opacity: 1 }],
                    w,
                    h,
                    frame,
                  ),
                ),
              )
                .negate({ alpha: false })
                .png()
                .toFile(
                  path.join(work, `mask-${String(frame).padStart(6, "0")}.png`),
                );
            }
            const file = path.join(work, "mask.mp4");
            await runProcess(
              binary,
              [
                "-v",
                "error",
                "-y",
                "-framerate",
                String(timeline.fps),
                "-i",
                path.join(work, "mask-%06d.png"),
                "-t",
                String(initialDuration),
                ...videoEncoding(),
                file,
              ],
              signal,
            );
            mask = await dataUri(file, "video/mp4");
          } else if (m?.kind === "image") {
            const file = path.join(work, "mask.mp4"),
              maskImage = path.join(work, "import-mask.png");
            await sharp(media.file(m)).png().toFile(maskImage);
            await runProcess(
              binary,
              [
                "-v",
                "error",
                "-y",
                "-loop",
                "1",
                "-i",
                maskImage,
                "-t",
                String(initialDuration),
                "-vf",
                `scale=${asset.width ?? 1280}:${asset.height ?? 720},fps=${timeline.fps},format=gray`,
                ...videoEncoding(),
                file,
              ],
              signal,
            );
            mask = await dataUri(file, "video/mp4");
          } else if (operation.maskAssetId)
            mask = await extra(operation.maskAssetId);
        }
        const result = await processAdvancedMedia(
          provider,
          capability,
          {
            source: await dataUri(
              base,
              asset.kind === "image"
                ? "image/png"
                : base === source
                  ? sourceMime(asset)
                  : "video/mp4",
            ),
            ...(mask ? { mask } : {}),
            ...("audioAssetId" in operation
              ? { audio: await extra(operation.audioAssetId, true) }
              : {}),
            ...("prompt" in operation ? { prompt: operation.prompt } : {}),
            ...(operation.type === "upscale"
              ? { scale: Number(operation.scale) }
              : {}),
          },
          progress,
        );
        await download(result.url, output, signal, provider);
      } else if (
        operation.type === "proxy" &&
        asset.colorSpace?.startsWith("rec2020")
      ) {
        const cube = path.join(work, "proxy-color.cube");
        await fs.writeFile(
          cube,
          colorConversionCube(
            asset.colorSpace,
            "rec709",
            timeline.profile?.peakNits ?? 1000,
          ),
        );
        await runProcess(
          binary,
          [
            "-v",
            "error",
            "-y",
            "-i",
            base,
            "-vf",
            `${conversionFilter(asset.colorSpace, "rec709", cube)},scale=w='min(${operation.width},iw)':h=-2`,
            ...videoEncoding(),
            "-c:a",
            "aac",
            ...colorTags("rec709"),
            output,
          ],
          signal,
        );
      } else {
        const graph = processingFilterGraph(
          operation,
          initialDuration,
          timeline.fps,
          hasVideo,
          hasAudio,
        );
        await runProcess(
          binary,
          [
            "-v",
            "error",
            "-y",
            "-i",
            base,
            "-filter_complex",
            graph.filter,
            ...graph.maps,
            ...(hasVideo ? videoEncoding() : []),
            ...(hasAudio ? ["-c:a", hasVideo ? "aac" : "pcm_s16le"] : []),
            "-t",
            String(graph.duration),
            output,
          ],
          signal,
        );
      }
    }
    signal.throwIfAborted();
    const info = await media.inspect(
      output,
      `${feature.name}${path.extname(output)}`,
    );
    if (!info.duration || info.duration <= 0)
      throw new Error("处理输出没有有效时长");
    if (
      ["remove-background", "inpaint", "upscale", "lip-sync"].includes(
        operation.type,
      ) &&
      Math.abs(info.duration - initialDuration) > 2 / timeline.fps
    )
      warnings.push(
        `模型输出为 ${info.duration.toFixed(2)} 秒，原片段为 ${initialDuration.toFixed(2)} 秒，应用后片段时长会改变。`,
      );
    const hash = await fileHash(output),
      assetId = crypto.randomUUID(),
      now = new Date().toISOString();
    const candidate = assetSchema.parse({
      ...info,
      id: assetId,
      name: `${asset.name} · ${feature.name}`,
      url: "/media/" + path.basename(output),
      size: (await fs.stat(output)).size,
      hash,
      createdAt: now,
      folder: "处理结果",
      provenance: {
        operation: operation.type,
        sourceAssetIds: [asset.id],
        parameters: operation,
        createdAt: now,
      },
      ...(operation.type === "remove-background" ? { alpha: true } : {}),
      ...(operation.type === "color-convert"
        ? { colorSpace: operation.output }
        : {}),
    });
    if (operation.type === "color-convert") {
      const proxyFile = path.join(media.dir, `${job.id}-preview.mp4`),
        cube = path.join(work, "preview.cube");
      await fs.writeFile(
        cube,
        colorConversionCube(operation.output, "rec709", operation.peakNits),
      );
      await runProcess(
        binary,
        [
          "-v",
          "error",
          "-y",
          "-i",
          output,
          "-vf",
          `${conversionFilter(operation.output, "rec709", cube)},scale=w='min(960,iw)':h=-2`,
          ...videoEncoding(),
          "-c:a",
          "aac",
          ...colorTags("rec709"),
          proxyFile,
        ],
        signal,
      );
      const proxyInfo = await media.inspect(proxyFile, "preview.mp4");
      candidate.proxy = {
        url: "/media/" + path.basename(proxyFile),
        hash: await fileHash(proxyFile),
        sourceHash: hash,
        width: proxyInfo.width!,
        height: proxyInfo.height!,
        createdAt: now,
      };
    }
    if ((await fileHash(source)) !== sourceHash)
      throw new Error("处理期间源文件发生变化，结果未应用");

    repo.save("media-cache", {
      id: key,
      file: path.basename(output),
      hash,
      info,
    });
    let commands: Command[] = [
      { type: "project.assert", dependencies },
      { type: "asset.add", asset: candidate },
    ];
    if (operation.type === "proxy") {
      if (asset.kind !== "video") throw new Error("代理预览需要视频素材");
      commands = [
        commands[0],
        {
          type: "asset.update",
          assetId: asset.id,
          patch: {
            proxy: {
              url: candidate.url,
              hash,
              width: candidate.width!,
              height: candidate.height!,
              sourceHash,
              createdAt: now,
            },
          },
        },
      ];
    } else if (clip) {
      const patch = processedClipPatch(
        clip,
        candidate.id,
        Math.max(1, Math.round(candidate.duration! * timeline.fps)),
        operation.type === "reverse",
      );
      commands.push({
        type: "clip.update",
        timelineId: timeline.id,
        clipId: clip.id,
        patch,
      });
      if (
        operation.type === "remove-background" &&
        operation.backgroundAssetId
      ) {
        const bg = project.assets.find(
          (a) => a.id === operation.backgroundAssetId,
        )!;
        if (!["image", "video"].includes(bg.kind))
          throw new Error("背景需要图片或视频");
        const track = newTrack(timeline, "video", crypto.randomUUID());
        commands.push({ type: "track.add", timelineId: timeline.id, track });
        const index = timeline.tracks.findIndex((t) => t.id === clip.trackId);
        commands.push(
          {
            type: "track.reorder",
            timelineId: timeline.id,
            ids: [
              ...timeline.tracks.slice(0, index).map((t) => t.id),
              track.id,
              ...timeline.tracks.slice(index).map((t) => t.id),
            ],
          },
          {
            type: "clip.add",
            timelineId: timeline.id,
            clip: clipSchema.parse({
              id: crypto.randomUUID(),
              assetId: bg.id,
              trackId: track.id,
              start: clip.start,
              duration: patch.duration,
            }),
          },
        );
      }
    }
    progress(99, "候选结果已就绪");
    return {
      label: feature.name,
      commands,
      assetId: operation.type === "proxy" ? asset.id : assetId,
      url: candidate.url,
      previewUrl: candidate.proxy?.url ?? candidate.url,
      warnings,
      cached: Boolean(cached),
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

async function prerenderCandidate(
  ctx: { repo: Repository; media: MediaService; root: string },
  snapshot: Snapshot,
  { job, signal, progress }: JobContext,
): Promise<ProcessResult> {
  const { project, timeline, clip, asset, dependencies } = snapshot;
  if (!clip) throw new Error("预渲染需要片段");
  const key = digest(JSON.stringify(["prerender-v2", dependencies]));
  const cached = ctx.repo.record<{ id: string; url: string; hash: string }>(
    "prerender-cache",
    key,
  );
  let file = path.join(ctx.media.dir, `${job.id}.webm`),
    reused = false;
  if (cached && /^\/media\/[a-zA-Z0-9._-]+$/.test(cached.url)) {
    const previous = path.join(ctx.media.dir, path.basename(cached.url));
    if (
      await fileHash(previous).then(
        (h) => h === cached.hash,
        () => false,
      )
    ) {
      file = previous;
      reused = true;
    }
  }
  const work = await fs.mkdtemp(path.join(ctx.media.dir, "prerender-"));
  try {
    if (!reused) {
      const solo = singleClipTimeline(timeline, clip.id);
      solo.tracks[0].volume = 1;
      solo.background = "transparent";
      const result = await exportMedia({
        project,
        timeline: solo,
        codec: "vp9",
        transparent: true,
        crf: 18,
        root: ctx.root,
        output: work,
        baseUrl: ctx.repo.settings("server-url", "http://127.0.0.1:4317"),
        mediaToken: ctx.repo.settings("media-token", ""),
        concurrency: 1,
        signal,
        progress,
      });
      await fs.copyFile(path.join(work, result.filename), file);
    }
    const now = new Date().toISOString(),
      hash = await fileHash(file),
      info = await ctx.media.inspect(file, "prerender.webm"),
      candidate = assetSchema.parse({
        ...info,
        id: crypto.randomUUID(),
        kind: "video",
        name: asset.name + " · 预渲染",
        alpha: true,
        url: "/media/" + path.basename(file),
        hash,
        width: timeline.width,
        height: timeline.height,
        duration: clip.duration / timeline.fps,
        createdAt: now,
        folder: "处理结果",
        provenance: {
          operation: "prerender",
          sourceAssetIds: [asset.id],
          parameters: { clipId: clip.id },
          createdAt: now,
        },
      });
    const defaults = clipSchema.parse({
      id: clip.id,
      assetId: candidate.id,
      trackId: clip.trackId,
      start: clip.start,
      duration: clip.duration,
    });
    const { id: _id, ...patch } = {
      ...defaults,
      name: clip.name,
      groupId: clip.groupId,
      linkId: clip.linkId,
      shotId: clip.shotId,
      transition: clip.transition,
      fit: "contain" as const,
      advanced: {
        ...(clip.advanced?.blend ? { blend: clip.advanced.blend } : {}),
      },
    };
    ctx.repo.save("prerender-cache", { id: key, url: candidate.url, hash });
    return {
      label: "预渲染缓存",
      commands: [
        { type: "project.assert", dependencies },
        { type: "asset.add", asset: candidate },
        {
          type: "clip.update",
          timelineId: timeline.id,
          clipId: clip.id,
          patch,
        },
      ],
      assetId: candidate.id,
      url: candidate.url,
      previewUrl: candidate.url,
      cached: reused,
      warnings: [],
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
