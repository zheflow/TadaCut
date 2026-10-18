import type { Asset, Project, Timeline } from "@tadacut/domain";
import { renderFrames } from "../../../packages/render/src/exporter";
import { mediaBinary, type MediaService } from "./media";
import { runProcess } from "./process";
import type { Repository } from "./storage";

/**
 * Frames for a model to look at. Timeline frames are rendered by the same
 * renderer as exports (effects, captions and transitions included); asset
 * frames come straight from the source file.
 */
export async function timelineImages(
  repo: Repository,
  root: string,
  project: Project,
  timeline: Timeline,
  frames: number[],
  signal: AbortSignal,
  scale = 0.5,
) {
  const rendered = await renderFrames({
    project,
    timeline,
    frames,
    root,
    baseUrl: repo.settings("server-url", "http://127.0.0.1:4317"),
    mediaToken: repo.settings("media-token", ""),
    scale,
    signal,
  });
  return rendered.map((r) => ({
    frame: r.frame,
    image: "data:image/jpeg;base64," + r.jpeg.toString("base64"),
  }));
}
/** Source frames of an image or video asset at the given seconds. */
export async function assetImages(
  media: MediaService,
  asset: Asset,
  seconds: number[],
  signal: AbortSignal,
  width = 768,
) {
  if (asset.kind === "image") {
    const { default: sharp } = await import("sharp");
    const bytes = await sharp(media.file(asset))
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return [
      {
        seconds: 0,
        image: "data:image/jpeg;base64," + bytes.toString("base64"),
      },
    ];
  }
  if (asset.kind !== "video") throw new Error("只能查看图片或视频素材的画面");
  const ffmpeg = mediaBinary("ffmpeg");
  if (!ffmpeg) throw new Error("视频取帧需要 FFmpeg");
  const out: { seconds: number; image: string }[] = [];
  for (const at of seconds.slice(0, 8)) {
    const time = Math.max(0, Math.min((asset.duration ?? at + 1) - 0.05, at));
    const { stdout } = await runProcess(
      ffmpeg,
      [
        "-v",
        "error",
        "-ss",
        String(time),
        "-i",
        media.file(asset),
        "-frames:v",
        "1",
        "-vf",
        `scale=${width}:-2`,
        "-f",
        "image2pipe",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ],
      signal,
      8 * 1024 * 1024,
    );
    out.push({
      seconds: time,
      image: "data:image/jpeg;base64," + stdout.toString("base64"),
    });
  }
  return out;
}
/** Raw RGBA pixels of one source frame, small, for color checks on the server. */
export async function assetPixels(
  media: MediaService,
  asset: Asset,
  seconds: number,
  signal: AbortSignal,
  width = 320,
) {
  const { default: sharp } = await import("sharp");
  const [frame] = await assetImages(media, asset, [seconds], signal, width);
  const bytes = Buffer.from(frame.image.split(",")[1], "base64");
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    width: info.width,
    height: info.height,
  };
}
