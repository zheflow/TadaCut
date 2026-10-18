import fs from "node:fs/promises";
import path from "node:path";
import {
  colorConversionCube,
  colorExportSupport,
  durationInFrames,
  rationalFrameRate,
  timelineProfileSchema,
  type Asset,
  type Clip,
  type Project,
  type Timeline,
} from "@tadacut/domain";
import { audioVoices } from "../../../packages/render/src/plan";
import { exportMedia } from "../../../packages/render/src/exporter";
import { mediaBinary, MediaService } from "./media";
import { runProcess } from "./process";
import { tempoFilters } from "./media-filters";
const escaped = (file: string) =>
  file.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
export function colorTags(space: string) {
  return [
    "-color_primaries",
    space.startsWith("rec2020") ? "bt2020" : "bt709",
    "-color_trc",
    space === "rec2020-pq"
      ? "smpte2084"
      : space === "rec2020-hlg"
        ? "arib-std-b67"
        : space === "srgb"
          ? "iec61966-2-1"
          : "bt709",
    "-colorspace",
    space.startsWith("rec2020") ? "bt2020nc" : "bt709",
  ];
}
export function conversionFilter(input: string, output: string, cube: string) {
  // Keep 16-bit RGB between the LUT and scales: older bundled FFmpeg builds
  // cannot negotiate floating-point RGB with swscale. The output stays 10-bit.
  return `scale=in_color_matrix=${input.startsWith("rec2020") ? "bt2020" : "bt709"}:out_range=full,format=gbrp16le,lut3d=file='${escaped(cube)}':interp=tetrahedral,scale=out_color_matrix=${output.startsWith("rec2020") ? "bt2020" : "bt709"}:out_range=tv,format=yuv444p10le,setparams=color_primaries=${output.startsWith("rec2020") ? "bt2020" : "bt709"}:color_trc=${output === "rec2020-pq" ? "smpte2084" : output === "rec2020-hlg" ? "arib-std-b67" : output === "srgb" ? "iec61966-2-1" : "bt709"}:colorspace=${output.startsWith("rec2020") ? "bt2020nc" : "bt709"}`;
}
export async function exportManagedColor(
  options: Parameters<typeof exportMedia>[0] & {
    media: MediaService;
    allowSdrComposite?: boolean;
  },
) {
  const { project, timeline, media, signal, progress } = options,
    profile =
      timeline.profile ??
      timelineProfileSchema.parse({ rate: rationalFrameRate(timeline.fps) });
  const support = colorExportSupport(project, timeline),
    hdr = profile.outputSpace.startsWith("rec2020");
  if (hdr && !["h265", "prores"].includes(options.codec))
    throw new Error("HDR 输出请选择 H.265 或 ProRes，输出采用 10 位像素");
  if (options.transparent) throw new Error("色彩管理导出暂不支持透明通道");
  const ffmpeg = mediaBinary("ffmpeg"),
    ffprobe = mediaBinary("ffprobe");
  if (!ffmpeg || !ffprobe) throw new Error("本机色彩处理组件不可用");
  const temp = await fs.mkdtemp(path.join(options.output, "color-"));
  const warnings: string[] = [];
  const temporarySources: string[] = [];
  if (
    options.range &&
    timeline.clips.some(
      (c) =>
        (c.fadeIn &&
          options.range![0] > c.start &&
          options.range![0] < c.start + c.fadeIn) ||
        (c.fadeOut &&
          options.range![0] > c.start + c.duration - c.fadeOut &&
          options.range![0] < c.start + c.duration),
    )
  ) {
    support.native = false;
    support.reasons.push("从淡入淡出中间开始的范围");
  }
  try {
    if (!support.native) {
      if (!options.allowSdrComposite)
        throw new Error(
          `当前工程包含${support.reasons.join("、")}。请选择“允许 SDR 特效合成”后导出；此模式会先压缩 HDR 高光。保留原始 HDR 高光可用基础剪辑序列。`,
        );
      warnings.push(
        "使用 SDR 特效合成：HDR 高光已压缩，输出仍按目标空间转换并编码为 10 位",
      );
      progress(2, warnings[0]);
      const prepared = structuredClone(project);
      for (const asset of prepared.assets) {
        if (
          !asset.colorSpace?.startsWith("rec2020") ||
          !["video", "image"].includes(asset.kind)
        )
          continue;
        const out = path.join(
            media.dir,
            `color-preview-${crypto.randomUUID()}.mp4`,
          ),
          cube = path.join(temp, `${crypto.randomUUID()}.cube`);
        temporarySources.push(out);
        await fs.writeFile(
          cube,
          colorConversionCube(asset.colorSpace, "rec709", profile.peakNits),
        );
        await runProcess(
          ffmpeg,
          [
            "-v",
            "error",
            "-y",
            "-i",
            media.file(asset),
            "-vf",
            conversionFilter(asset.colorSpace, "rec709", cube),
            "-c:v",
            process.platform === "darwin" ? "h264_videotoolbox" : "libx264",
            ...(process.platform === "darwin"
              ? ["-allow_sw", "1", "-b:v", "16M"]
              : ["-crf", "16"]),
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            ...colorTags("rec709"),
            out,
          ],
          signal,
        );
        asset.url = "/media/" + path.basename(out);
        asset.colorSpace = "rec709";
      }
      const composed = await exportMedia({
        ...options,
        project: prepared,
        timeline: { ...timeline, profile: undefined },
        codec: "prores",
        transparent: false,
        output: temp,
      });
      const cube = path.join(temp, "output.cube");
      await fs.writeFile(
        cube,
        colorConversionCube("rec709", profile.outputSpace, profile.peakNits),
      );
      const filename = `TadaCut-${project.revision}-color.${options.codec === "prores" ? "mov" : "mp4"}`;
      await runProcess(
        ffmpeg,
        [
          "-v",
          "error",
          "-y",
          "-i",
          path.join(temp, composed.filename),
          "-vf",
          conversionFilter("rec709", profile.outputSpace, cube),
          ...encoding(options.codec, hdr),
          "-c:a",
          options.codec === "prores" ? "pcm_s16le" : "aac",
          ...colorTags(profile.outputSpace),
          path.join(options.output, filename),
        ],
        signal,
      );
      return { filename, warnings };
    }
    const total = durationInFrames(timeline),
      lo = Math.max(0, options.range?.[0] ?? 0),
      hi = Math.min(total, options.range?.[1] ?? total);
    if (hi <= lo) throw new Error("导出范围为空");
    const fps = `${profile.rate.numerator}/${profile.rate.denominator}`,
      segments: { start: number; end: number; clip?: Clip }[] = [];
    const visible = timeline.clips
      .filter(
        (c) =>
          !timeline.tracks.find((t) => t.id === c.trackId)?.hidden &&
          project.assets.some(
            (a) => a.id === c.assetId && ["image", "video"].includes(a.kind),
          ) &&
          c.start < hi &&
          c.start + c.duration > lo,
      )
      .sort((a, b) => a.start - b.start);
    let cursor = lo;
    for (const c of visible) {
      if (c.start > cursor) segments.push({ start: cursor, end: c.start });
      segments.push({
        start: Math.max(lo, c.start),
        end: Math.min(hi, c.start + c.duration),
        clip: c,
      });
      cursor = Math.min(hi, c.start + c.duration);
    }
    if (cursor < hi) segments.push({ start: cursor, end: hi });
    const color =
        /^#([a-f0-9]{6})$/i.exec(timeline.background)?.[1] ?? "000000",
      ppm = Buffer.concat([
        Buffer.from("P6\n1 1\n255\n"),
        Buffer.from(color, "hex"),
      ]),
      background = path.join(temp, "background.ppm");
    await fs.writeFile(background, ppm);
    const files: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      signal.throwIfAborted();
      const seg = segments[i],
        c = seg.clip,
        a = c ? project.assets.find((a) => a.id === c.assetId) : undefined;
      const input = a ? media.file(a) : background,
        space = a?.colorSpace ?? "srgb",
        cube = path.join(temp, `grade-${i}.cube`);
      await fs.writeFile(
        cube,
        colorConversionCube(
          a?.kind === "video" ? (a.colorSpace ?? "rec709") : space,
          profile.outputSpace,
          profile.peakNits,
          33,
          profile.workingSpace,
        ),
      );
      const duration = (seg.end - seg.start) / timeline.fps,
        start = c
          ? c.sourceOffset + ((seg.start - c.start) / timeline.fps) * c.speed
          : 0;
      const scale =
        c?.fit === "contain"
          ? `scale=${timeline.width}:${timeline.height}:force_original_aspect_ratio=decrease,pad=${timeline.width}:${timeline.height}:(ow-iw)/2:(oh-ih)/2:color=${timeline.background}`
          : `scale=${timeline.width}:${timeline.height}:force_original_aspect_ratio=increase,crop=${timeline.width}:${timeline.height}`;
      const filters = [
        `setpts=(PTS-STARTPTS)/${c?.speed ?? 1}`,
        `fps=${fps}`,
        scale,
        conversionFilter(
          a?.kind === "video" ? (a.colorSpace ?? "rec709") : space,
          profile.outputSpace,
          cube,
        ),
      ];
      if (c?.fadeIn)
        filters.push(
          `fade=t=in:st=${(c.start - seg.start) / timeline.fps}:d=${c.fadeIn / timeline.fps}`,
        );
      if (c?.fadeOut)
        filters.push(
          `fade=t=out:st=${(c.start + c.duration - c.fadeOut - seg.start) / timeline.fps}:d=${c.fadeOut / timeline.fps}`,
        );
      const file = path.join(temp, `segment-${i}.mov`);
      await runProcess(
        ffmpeg,
        [
          "-v",
          "error",
          "-y",
          ...(a?.kind === "video"
            ? ["-ss", String(start), "-t", String(duration * (c?.speed ?? 1))]
            : ["-loop", "1"]),
          "-i",
          input,
          "-an",
          "-vf",
          filters.join(","),
          "-frames:v",
          String(seg.end - seg.start),
          "-c:v",
          "prores_ks",
          "-profile:v",
          "3",
          "-pix_fmt",
          "yuv444p10le",
          ...colorTags(profile.outputSpace),
          file,
        ],
        signal,
      );
      files.push(file);
      progress(5 + (70 * (i + 1)) / segments.length, "高位深画面处理");
    }
    const list = path.join(temp, "segments.txt");
    await fs.writeFile(
      list,
      files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"),
    );
    const inputs = ["-f", "concat", "-safe", "0", "-i", list],
      graph: string[] = [],
      labels: string[] = [];
    let inputIndex = 1;
    for (const voice of audioVoices(
      timeline,
      project.assets,
      project.timelines,
    )) {
      const begin = Math.max(lo, voice.start),
        end = Math.min(hi, voice.start + voice.duration);
      if (end <= begin) continue;
      const file = media.file(voice.asset);
      const probe = JSON.parse(
        (
          await runProcess(
            ffprobe,
            ["-v", "error", "-show_streams", "-of", "json", file],
            signal,
            2 * 1024 * 1024,
          )
        ).stdout.toString(),
      );
      if (
        !probe.streams.some(
          (s: { codec_type: string }) => s.codec_type === "audio",
        )
      )
        continue;
      inputs.push(
        "-ss",
        String(
          voice.sourceStart +
            ((begin - voice.start) / timeline.fps) * voice.rate,
        ),
        "-t",
        String(((end - begin) / timeline.fps) * voice.rate),
        "-i",
        file,
      );
      const commands: string[] = [];
      let previous = -1;
      for (let f = 0; f < end - begin; f++) {
        const gain =
          Math.round(voice.gain(begin - voice.start + f) * 10000) / 10000;
        if (gain !== previous) {
          commands.push(
            `${(f / timeline.fps).toFixed(8)} volume@gain${inputIndex} volume ${gain};`,
          );
          previous = gain;
        }
      }
      const changes = path.join(temp, `gain-${inputIndex}.txt`);
      await fs.writeFile(changes, commands.join("\n"));
      graph.push(
        `[${inputIndex}:a]asetpts=PTS-STARTPTS,${tempoFilters(voice.rate)},asendcmd=f='${escaped(changes)}',volume@gain${inputIndex}=1,adelay=${Math.round(((begin - lo) / timeline.fps) * 1000)}:all=1[a${inputIndex}]`,
      );
      labels.push(`[a${inputIndex}]`);
      inputIndex++;
    }
    const filename = `TadaCut-${project.revision}-${profile.outputSpace}.${options.codec === "prores" ? "mov" : "mp4"}`;
    if (labels.length)
      graph.push(
        `${labels.join("")}amix=inputs=${labels.length}:normalize=0,apad,atrim=duration=${(hi - lo) / timeline.fps}[mix]`,
      );
    const filterFile = path.join(temp, "mix.txt");
    if (graph.length) await fs.writeFile(filterFile, graph.join(";"));
    await runProcess(
      ffmpeg,
      [
        "-v",
        "error",
        "-y",
        ...inputs,
        ...(labels.length
          ? [
              "-filter_complex_script",
              filterFile,
              "-map",
              "0:v",
              "-map",
              "[mix]",
            ]
          : ["-map", "0:v", "-an"]),
        ...(options.codec === "prores"
          ? ["-c:v", "copy"]
          : encoding(options.codec, hdr)),
        ...(labels.length
          ? ["-c:a", options.codec === "prores" ? "pcm_s16le" : "aac"]
          : []),
        ...colorTags(profile.outputSpace),
        "-t",
        String((hi - lo) / timeline.fps),
        path.join(options.output, filename),
      ],
      signal,
    );
    progress(99, "色彩管理导出完成");
    return { filename, warnings };
  } finally {
    await Promise.allSettled(
      temporarySources.map((file) => fs.rm(file, { force: true })),
    );
    await fs.rm(temp, { recursive: true, force: true });
  }
}
function encoding(codec: string, hdr: boolean) {
  if (codec === "prores")
    return ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv444p10le"];
  if (!["h264", "h265"].includes(codec))
    throw new Error("色彩管理导出支持 H.264、H.265 和 ProRes");
  return [
    "-c:v",
    process.platform === "darwin"
      ? codec === "h265"
        ? "hevc_videotoolbox"
        : "h264_videotoolbox"
      : codec === "h265"
        ? "libx265"
        : "libx264",
    ...(process.platform === "darwin"
      ? ["-allow_sw", "1", "-b:v", "20M"]
      : ["-crf", "18"]),
    "-pix_fmt",
    hdr ? "p010le" : "yuv420p",
    ...(codec === "h265" ? ["-tag:v", "hvc1"] : []),
  ];
}
