import { completeChat, type ProviderContext } from "@tadacut/providers";
import type { Asset } from "@tadacut/domain";
import { mediaBinary, type MediaService } from "./media";
import { runProcess } from "./process";
export async function understandMedia(
  media: MediaService,
  asset: Asset,
  context: ProviderContext,
) {
  const images: string[] = [];
  if (asset.kind === "image") {
    const { default: sharp } = await import("sharp");
    const bytes = await sharp(media.file(asset))
      .resize({ width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    images.push("data:image/jpeg;base64," + bytes.toString("base64"));
  } else if (asset.kind === "video") {
    const ffmpeg = mediaBinary("ffmpeg");
    if (!ffmpeg) throw new Error("视频取样需要 FFmpeg");
    for (const seconds of [
      0,
      (asset.duration ?? 6) / 3,
      ((asset.duration ?? 6) * 2) / 3,
    ]) {
      const { stdout } = await runProcess(
        ffmpeg,
        [
          "-v",
          "error",
          "-ss",
          String(seconds),
          "-i",
          media.file(asset),
          "-frames:v",
          "1",
          "-vf",
          "scale=1024:-2",
          "-f",
          "image2pipe",
          "-c:v",
          "mjpeg",
          "pipe:1",
        ],
        context.signal,
        4 * 1024 * 1024,
      );
      images.push("data:image/jpeg;base64," + stdout.toString("base64"));
    }
  } else throw new Error("素材理解支持图片或视频；音频可使用 CLAP");
  let text = "";
  await completeChat(
    context,
    "根据用户选择素材的取样画面，只描述可见事实，避免猜测整段视频或音频。返回 JSON：{description:简洁中文描述,tags:字符串数组}。",
    [
      {
        role: "user",
        content: `素材名称：${asset.name}。${asset.kind === "video" ? "这是开始、三分之一和三分之二时刻的画面取样。" : "这是源图片。"}`,
        images,
      },
    ],
    [],
    (delta) => (text += delta),
  );
  try {
    const value = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, ""),
    );
    return {
      description: String(value.description).slice(0, 20000),
      tags: Array.isArray(value.tags)
        ? value.tags.filter((t: unknown) => typeof t === "string").slice(0, 20)
        : ([] as string[]),
      sampledFrames: images.length,
    };
  } catch {
    return {
      description: text.slice(0, 20000),
      tags: [] as string[],
      sampledFrames: images.length,
    };
  }
}
