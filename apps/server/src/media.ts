import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import {
  analyzePcm,
  assetSchema,
  detectBeats,
  detectSilence,
  isLutAsset,
  parseCube,
  type Asset,
} from "@tadacut/domain";
import type { Repository } from "./storage";
import { executable, runProcess } from "./process";
const require = createRequire(import.meta.url);
function mediaRoots() {
  const resources = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  return [
    resources ? path.join(resources, "ffmpeg") : "",
    path.resolve("build/ffmpeg"),
  ];
}
/** The LGPL build from scripts/build-ffmpeg.mjs: in the app's resources when
 * packaged, under build/ in a checkout. */
export function bundledMediaBinary(
  name: "ffmpeg" | "ffprobe",
  roots = mediaRoots(),
) {
  for (const dir of roots) {
    const file = path.join(dir, name);
    if (
      dir &&
      fs.existsSync(path.join(dir, "tadacut-ffmpeg.json")) &&
      fs.existsSync(file)
    )
      return file;
  }
  return null;
}
export function mediaBinary(name: "ffmpeg" | "ffprobe") {
  if (process.env[`TADACUT_${name.toUpperCase()}_PATH`])
    return executable(name);
  const bundled = bundledMediaBinary(name);
  if (bundled) return bundled;
  try {
    const installer = require(
      name === "ffmpeg"
        ? "@ffmpeg-installer/ffmpeg"
        : "@ffprobe-installer/ffprobe",
    );
    const filename = installer.path.replace(
      /app\.asar([/\\])/,
      "app.asar.unpacked$1",
    );
    if (fs.existsSync(filename)) return filename as string;
  } catch {}
  return executable(name);
}
/** Audio containers that speech services accept as uploaded. */
const audioTypes: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
};
export class MediaService {
  constructor(
    public repo: Repository,
    public dir: string,
    private publish: (type: string, data: unknown) => void,
  ) {
    fs.mkdirSync(dir, { recursive: true });
  }
  file(asset: Asset) {
    const name = /^\/media\/([a-zA-Z0-9._-]+)$/.exec(asset.url)?.[1];
    if (!name || name === "." || name === "..")
      throw new Error("请先重连或导入本地素材");
    const file = path.join(this.dir, name);
    if (!fs.existsSync(file)) throw new Error("素材文件失联，请重新关联文件");
    return file;
  }
  extension(name: string) {
    const ext = path.extname(name).toLowerCase();
    return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ".bin";
  }
  async inspect(file: string, name: string, mime = "") {
    let data: any = null;
    const probe = mediaBinary("ffprobe");
    if (probe && !isLutAsset({ name })) {
      try {
        data = JSON.parse(
          (
            await runProcess(
              probe,
              [
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                file,
              ],
              undefined,
              4 * 1024 * 1024,
            )
          ).stdout.toString(),
        );
      } catch {}
    }
    const video = data?.streams?.find((s: any) => s.codec_type === "video"),
      audio = data?.streams?.find((s: any) => s.codec_type === "audio");
    const kind = isLutAsset({ name })
      ? "text"
      : mime.startsWith("image/") ||
          /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name)
        ? "image"
        : video
          ? "video"
          : audio
            ? "audio"
            : mime.startsWith("audio/") ||
                /\.(mp3|wav|m4a|ogg|flac)$/i.test(name)
              ? "audio"
              : "video";
    let dimensions = video ? { width: video.width, height: video.height } : {};
    if (name.endsWith(".svg")) {
      const text = await fsp.readFile(file, "utf8");
      const match =
        /viewBox=["']\s*[-.\d]+\s+[-.\d]+\s+([.\d]+)\s+([.\d]+)["']/.exec(text);
      if (match)
        dimensions = { width: Number(match[1]), height: Number(match[2]) };
    }
    const duration = Number(
      data?.format?.duration ?? audio?.duration ?? video?.duration,
    );
    return {
      kind,
      ...dimensions,
      timecode: data?.format?.tags?.timecode ?? video?.tags?.timecode,
      ...(Number.isFinite(duration) && duration >= 0 ? { duration } : {}),
    } as Partial<Asset>;
  }
  async register(
    projectId: string,
    file: string,
    name: string,
    mime = "",
    extra: Partial<Asset> = {},
  ) {
    const data = await fsp.readFile(file),
      hash = crypto.createHash("sha256").update(data).digest("hex");
    const p = this.repo.get(projectId),
      existing = p.assets.find((a) => a.hash === hash);
    if (existing && !extra.id) {
      if (file !== this.file(existing)) await fsp.unlink(file);
      return { project: p, asset: existing };
    }
    const info = await this.inspect(file, name, mime),
      asset = assetSchema.parse({
        id: extra.id ?? crypto.randomUUID(),
        name,
        url: "/media/" + path.basename(file),
        tags: [],
        description: "",
        folder: "导入素材",
        color: info.kind === "audio" ? "#aa916c" : "#73959a",
        createdAt: new Date().toISOString(),
        ...(mime ? { mime } : {}),
        ...info,
        size: data.length,
        hash,
        originalPath: file,
        ...extra,
      });
    if (isLutAsset(asset)) {
      // Validate the table now; the renderer reads it from the media URL, so
      // 33³ and 65³ LUTs stay out of the project document and its history.
      parseCube(data.toString("utf8"));
      asset.tags = ["LUT"];
      asset.folder = "LUT";
    }
    if (asset.kind === "video") {
      const ffmpeg = mediaBinary("ffmpeg");
      if (ffmpeg) {
        const thumb = `${asset.id}-thumb.jpg`;
        try {
          await runProcess(
            ffmpeg,
            [
              "-v",
              "error",
              "-i",
              file,
              "-frames:v",
              "1",
              "-vf",
              "scale=480:-2",
              "-y",
              path.join(this.dir, thumb),
            ],
            undefined,
            4 * 1024 * 1024,
          );
          asset.thumbnail = "/media/" + thumb;
        } catch {}
      }
    }
    const current = this.repo.get(projectId);
    const command = current.assets.some((a) => a.id === asset.id)
      ? { type: "asset.update" as const, assetId: asset.id, patch: asset }
      : { type: "asset.add" as const, asset };
    if (command.type === "asset.update") {
      const { id, ...patch } = asset;
      command.patch = patch as any;
    }
    const result = this.repo.commit(projectId, {
      requestId: crypto.randomUUID(),
      expectedRevision: current.revision,
      label: "导入素材",
      commands: [command],
    });
    this.publish("project", result.project);
    return { project: result.project, asset };
  }
  async generated(
    projectId: string,
    name: string,
    data: { bytes?: Uint8Array; url?: string; mime: string },
    signal: AbortSignal,
    extra: Partial<Asset> = {},
  ) {
    let bytes = data.bytes,
      mime = data.mime;
    if (!bytes && data.url) {
      const url = new URL(data.url);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("服务返回了不支持的下载链接");
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error("生成素材下载未成功");
      if (
        response.headers.get("content-type") &&
        response.headers.get("content-type") !== "application/octet-stream"
      )
        mime = response.headers.get("content-type")!;
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (!bytes?.length || bytes.length > 512 * 1024 * 1024)
      throw new Error("生成结果为空或过大");
    signal.throwIfAborted();
    const ext = mime.includes("png")
      ? ".png"
      : mime.includes("jpeg")
        ? ".jpg"
        : mime.includes("webp")
          ? ".webp"
          : mime.includes("webm")
            ? ".webm"
            : mime.includes("video")
              ? ".mp4"
              : mime.includes("wav")
                ? ".wav"
                : mime.includes("ogg") || mime.includes("opus")
                  ? ".ogg"
                  : mime.includes("mp4")
                    ? ".m4a"
                    : ".mp3";
    const file = path.join(this.dir, crypto.randomUUID() + ext);
    await fsp.writeFile(file, bytes, { flag: "wx" });
    return this.register(projectId, file, name + ext, mime, extra);
  }
  async pcm(asset: Asset, signal: AbortSignal) {
    const ffmpeg = mediaBinary("ffmpeg");
    if (!ffmpeg) throw new Error("音频分析需要 FFmpeg");
    const output = await runProcess(
      ffmpeg,
      [
        "-v",
        "error",
        "-i",
        this.file(asset),
        "-t",
        "1200",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "f32le",
        "pipe:1",
      ],
      signal,
      80 * 1024 * 1024,
    );
    const data = output.stdout;
    const samples = new Float32Array(data.length / 4);
    for (let i = 0; i < samples.length; i++)
      samples[i] = data.readFloatLE(i * 4);
    return samples;
  }
  /**
   * The asset's sound as a speech service upload: audio files keep their bytes
   * with their real type; video and other containers become a mono WAV track.
   */
  async audioUpload(asset: Asset, signal: AbortSignal, sampleRate = 16000) {
    const source = this.file(asset),
      type = audioTypes[path.extname(source).toLowerCase()];
    if (asset.kind === "audio" && type)
      return {
        bytes: new Uint8Array(await fsp.readFile(source)),
        name: asset.name,
        mime: type,
      };
    const ffmpeg = mediaBinary("ffmpeg");
    if (!ffmpeg) throw new Error("提取音轨需要 FFmpeg");
    const output = path.join(this.dir, crypto.randomUUID() + ".upload.wav");
    try {
      await runProcess(
        ffmpeg,
        [
          "-v",
          "error",
          "-i",
          source,
          "-vn",
          "-ac",
          "1",
          "-ar",
          String(sampleRate),
          "-c:a",
          "pcm_s16le",
          "-y",
          output,
        ],
        signal,
      );
      return {
        bytes: new Uint8Array(await fsp.readFile(output)),
        name: asset.name.replace(/\.[^.]+$/, "") + ".wav",
        mime: "audio/wav",
      };
    } finally {
      await fsp.unlink(output).catch(() => {});
    }
  }
  async analyze(asset: Asset, signal: AbortSignal) {
    const samples = await this.pcm(asset, signal);
    const result = analyzePcm(samples, 8000);
    return {
      ...result,
      silence: detectSilence(result.envelopes, result.envelopeRate),
      beats: detectBeats(result.envelopes, result.envelopeRate),
    };
  }
  async normalize(
    projectId: string,
    asset: Asset,
    target: number,
    signal: AbortSignal,
  ) {
    const ffmpeg = mediaBinary("ffmpeg");
    if (!ffmpeg) throw new Error("响度归一需要 FFmpeg");
    const output = path.join(this.dir, crypto.randomUUID() + ".wav");
    await runProcess(
      ffmpeg,
      [
        "-v",
        "error",
        "-i",
        this.file(asset),
        "-vn",
        "-af",
        `loudnorm=I=${Math.max(-30, Math.min(-5, target))}:TP=-1.5:LRA=11`,
        "-ar",
        "48000",
        "-c:a",
        "pcm_s16le",
        "-y",
        output,
      ],
      signal,
    );
    signal.throwIfAborted();
    return this.register(
      projectId,
      output,
      asset.name.replace(/\.[^.]+$/, "") + "-响度归一.wav",
      "audio/wav",
      { tags: ["响度归一"] },
    );
  }
  async voiceClean(projectId: string, asset: Asset, signal: AbortSignal) {
    const ffmpeg = mediaBinary("ffmpeg");
    if (!ffmpeg) throw new Error("人声降噪需要 FFmpeg");
    const output = path.join(this.dir, crypto.randomUUID() + ".wav");
    await runProcess(
      ffmpeg,
      [
        "-v",
        "error",
        "-i",
        this.file(asset),
        "-vn",
        "-af",
        "highpass=f=80,lowpass=f=10000,afftdn=nf=-25",
        "-ar",
        "48000",
        "-c:a",
        "pcm_s16le",
        "-y",
        output,
      ],
      signal,
    );
    signal.throwIfAborted();
    return this.register(
      projectId,
      output,
      asset.name.replace(/\.[^.]+$/, "") + "-人声降噪.wav",
      "audio/wav",
      { tags: ["人声降噪"] },
    );
  }
}
