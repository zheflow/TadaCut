import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { zipSync } from "fflate";
import type { Project, Timeline } from "@tadacut/domain";
import { runProcess } from "./process";
import { type MediaService, mediaBinary } from "./media";
const require = createRequire(import.meta.url);
export function capcutEntry() {
  try {
    return path
      .join(
        path.dirname(require.resolve("capcut-cli/package.json")),
        "dist/index.js",
      )
      .replace(/app\.asar([/\\])/, "app.asar.unpacked$1");
  } catch {
    return null;
  }
}
/** A typed adapter to the published capcut-cli command protocol; never invokes a shell. */
export async function capcutDraft(
  p: Project,
  t: Timeline,
  media: MediaService,
  output: string,
) {
  const entry = capcutEntry();
  if (!entry) throw new Error("缺少 CapCut 草稿适配器，请重新安装可选依赖");
  const run = async (args: string[]) => {
    const result = await runProcess(
      process.execPath,
      [entry, ...args],
      AbortSignal.timeout(60000),
      8 * 1024 * 1024,
      { ELECTRON_RUN_AS_NODE: "1" },
    );
    const value = JSON.parse(result.stdout.toString());
    if (value.ok === false)
      throw new Error(value.error ?? "草稿工具未完成操作");
    return value;
  };
  const flags = ["--drafts", output, "--force-write"],
    name = "TadaCut-" + p.id.replace(/[^a-z0-9-]/gi, "").slice(0, 40);
  const created = await run([
    "init",
    name,
    "--template",
    "bundled",
    "--width",
    String(t.width),
    "--height",
    String(t.height),
    ...flags,
  ]);
  const draft = created.draft_path;
  if (
    typeof draft !== "string" ||
    !path.resolve(draft).startsWith(path.resolve(output) + path.sep)
  )
    throw new Error("草稿工具返回了无效目录");
  const warnings: string[] = [];
  for (const track of t.tracks) {
    if (track.hidden) continue;
    for (const clip of t.clips
      .filter((c) => c.trackId === track.id)
      .sort((a, b) => a.start - b.start)) {
      const asset = p.assets.find((a) => a.id === clip.assetId)!;
      if (asset.kind === "motion") {
        warnings.push(asset.name + "：代码动画请先导出媒体后替换");
        continue;
      }
      const begin = (clip.start / t.fps).toFixed(6) + "s",
        length = (clip.duration / t.fps).toFixed(6) + "s";
      if (asset.kind === "text") {
        await run([
          "add-text",
          draft,
          begin,
          length,
          clip.text ?? asset.text ?? clip.name,
          "--track-name",
          track.name,
          "--font-size",
          String(clip.textStyle?.fontSize ?? 48),
          "--color",
          clip.textStyle?.color ?? "#ffffff",
          ...flags,
        ]);
        continue;
      }
      let file = media.file(asset);
      if (asset.name.endsWith(".svg")) {
        const { default: sharp } = await import("sharp");
        file = path.join(output, asset.id.replace(/[^a-z0-9-]/gi, "") + ".png");
        await sharp(media.file(asset)).png().toFile(file);
      }
      const initialDuration =
        asset.kind === "image"
          ? clip.duration / t.fps
          : clip.sourceOffset + (clip.duration / t.fps) * clip.speed;
      const added = await run([
        asset.kind === "audio" ? "add-audio" : "add-video",
        draft,
        file,
        begin,
        initialDuration.toFixed(6) + "s",
        "--track-name",
        track.name,
        ...(mediaBinary("ffprobe")
          ? ["--ffprobe-cmd", mediaBinary("ffprobe")!]
          : []),
        ...flags,
      ]);
      if (added.segment_id) {
        if (asset.kind !== "image") {
          if (clip.speed !== 1)
            await run([
              "speed",
              draft,
              added.segment_id,
              String(clip.speed),
              ...flags,
            ]);
          if (clip.sourceOffset || clip.speed !== 1)
            await run([
              "trim",
              draft,
              added.segment_id,
              clip.sourceOffset.toFixed(6) + "s",
              ((clip.duration / t.fps) * clip.speed).toFixed(6) + "s",
              ...flags,
            ]);
        }
        await run([
          "volume",
          draft,
          added.segment_id,
          String(track.muted ? 0 : clip.volume * track.volume),
          ...flags,
        ]);
        if (clip.opacity !== 1)
          await run([
            "opacity",
            draft,
            added.segment_id,
            String(clip.opacity),
            ...flags,
          ]);
        if (asset.kind === "audio" && (clip.fadeIn || clip.fadeOut))
          await run([
            "audio-fade",
            draft,
            added.segment_id,
            "--in",
            String(clip.fadeIn / t.fps),
            "--fade-out",
            String(clip.fadeOut / t.fps),
            ...flags,
          ]);
      }
      if (
        clip.effects.shader ||
        clip.effects.lutAssetId ||
        clip.effects.chromaKey ||
        Object.keys(clip.keyframes).length ||
        clip.transition
      )
        warnings.push(
          (clip.name || asset.name) +
            "：外部草稿保留基础剪辑；动画、转场与效果请在目标软件复核",
        );
    }
  }
  await fs.writeFile(
    path.join(draft, "TadaCut-export.txt"),
    `TadaCut 草稿适配报告\n${warnings.join("\n")}\n模板兼容性由目标 CapCut / 剪映版本决定，可使用 capcut-cli migrate 与 relink 调整。`,
  );
  const files: Record<string, Uint8Array> = {};
  let total = 0;
  for (const file of await fs.readdir(draft, {
    recursive: true,
    withFileTypes: true,
  }))
    if (file.isFile()) {
      const full = path.join(file.parentPath, file.name),
        data = await fs.readFile(full);
      total += data.length;
      if (total > 512 * 1024 * 1024) throw new Error("草稿包超过 512 MB");
      files[name + "/" + path.relative(draft, full).split(path.sep).join("/")] =
        data;
    }
  await fs.writeFile(
    path.join(output, "capcut-draft.zip"),
    zipSync(files, { level: 1 }),
  );
  return { filename: "capcut-draft.zip", warnings };
}
