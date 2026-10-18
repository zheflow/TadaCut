import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  makeCancelSignal,
  openBrowser,
  renderMedia,
  renderStill,
  selectComposition,
  type Codec,
} from "@remotion/renderer";
import {
  durationInFrames,
  timelineSchema,
  type Project,
  type Timeline,
} from "../../domain/src/index";
import { findBrowser } from "../../../apps/server/src/process";
import { renderConcurrency, renderPlan } from "./plan";
/** What the render bundle receives: media URLs carry the server's access token. */
function renderProps(
  project: Project,
  timeline: Timeline,
  options: { baseUrl: string; mediaToken?: string },
  transparent: boolean,
) {
  return {
    timeline,
    timelines: project.timelines,
    transparent,
    baseUrl: options.baseUrl,
    assets: project.assets.map((a) => ({
      ...a,
      url: a.url.startsWith("/media/")
        ? `${options.baseUrl}${a.url}?access=${encodeURIComponent(options.mediaToken ?? "")}`
        : a.url,
    })),
  };
}
/**
 * A timeline holding one clip at frame 0, on an otherwise empty track, for
 * exporting a single layer (an animation, a title) with transparency.
 */
export function singleClipTimeline(t: Timeline, clipId: string): Timeline {
  const clip = t.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error("片段不存在");
  const track = t.tracks.find((x) => x.id === clip.trackId)!;
  return timelineSchema.parse({
    ...t,
    id: `${t.id}-single-${clip.id}`,
    tracks: [{ ...track, hidden: false, muted: false }],
    clips: [{ ...clip, start: 0, transition: undefined }],
    markers: [],
    multicam: [],
    watermark: undefined,
  });
}
/** Renders one frame to a PNG (or JPEG) file, for covers, thumbnails and the agent's view. */
export async function exportStill(options: {
  project: Project;
  timeline: Timeline;
  frame: number;
  root: string;
  output: string;
  baseUrl: string;
  mediaToken?: string;
  format?: "png" | "jpeg";
  scale?: number;
  signal: AbortSignal;
}) {
  const { project, timeline, signal } = options;
  signal.throwIfAborted();
  const serveUrl = path.join(options.root, "dist/render");
  if (!fs.existsSync(path.join(serveUrl, "index.html")))
    throw new Error("渲染资源缺失，请重新构建应用");
  const inputProps = renderProps(project, timeline, options, false),
    browserExecutable = findBrowser() ?? undefined,
    browser = await openBrowser("chrome", {
      browserExecutable,
      ...(process.platform === "darwin"
        ? { chromiumOptions: { gl: "angle" as const } }
        : {}),
    });
  const { cancel, cancelSignal } = makeCancelSignal(),
    stop = () => {
      cancel();
      void browser.close({ silent: true }).catch(() => {});
    };
  signal.addEventListener("abort", stop, { once: true });
  const format = options.format ?? "png",
    frame = Math.max(
      0,
      Math.min(durationInFrames(timeline) - 1, Math.round(options.frame)),
    ),
    filename = `TadaCut-${project.revision}-frame-${frame}.${format === "png" ? "png" : "jpg"}`;
  try {
    const composition = await selectComposition({
      serveUrl,
      id: "TadaCut",
      inputProps,
      browserExecutable,
      puppeteerInstance: browser,
      timeoutInMilliseconds: 120000,
    });
    await renderStill({
      serveUrl,
      composition,
      inputProps,
      browserExecutable,
      puppeteerInstance: browser,
      frame,
      output: path.join(options.output, filename),
      imageFormat: format,
      scale: Math.max(0.1, Math.min(2, options.scale ?? 1)),
      cancelSignal,
      timeoutInMilliseconds: 120000,
    });
    signal.throwIfAborted();
    return { filename, frame };
  } finally {
    signal.removeEventListener("abort", stop);
    await browser.close({ silent: true }).catch(() => {});
  }
}
/** Renders several frames as JPEG buffers in one browser session, for the agent to look at. */
export async function renderFrames(options: {
  project: Project;
  timeline: Timeline;
  frames: number[];
  root: string;
  baseUrl: string;
  mediaToken?: string;
  scale?: number;
  signal: AbortSignal;
}) {
  const { project, timeline, signal } = options;
  const serveUrl = path.join(options.root, "dist/render");
  if (!fs.existsSync(path.join(serveUrl, "index.html")))
    throw new Error("渲染资源缺失，请重新构建应用");
  const inputProps = renderProps(project, timeline, options, false),
    browserExecutable = findBrowser() ?? undefined,
    browser = await openBrowser("chrome", {
      browserExecutable,
      ...(process.platform === "darwin"
        ? { chromiumOptions: { gl: "angle" as const } }
        : {}),
    });
  const { cancel, cancelSignal } = makeCancelSignal(),
    stop = () => {
      cancel();
      void browser.close({ silent: true }).catch(() => {});
    };
  signal.addEventListener("abort", stop, { once: true });
  try {
    const composition = await selectComposition({
      serveUrl,
      id: "TadaCut",
      inputProps,
      browserExecutable,
      puppeteerInstance: browser,
      timeoutInMilliseconds: 120000,
    });
    const last = Math.max(0, durationInFrames(timeline) - 1),
      out: { frame: number; jpeg: Buffer }[] = [];
    for (const requested of options.frames.slice(0, 12)) {
      signal.throwIfAborted();
      const frame = Math.max(0, Math.min(last, Math.round(requested)));
      const { buffer } = await renderStill({
        serveUrl,
        composition,
        inputProps,
        browserExecutable,
        puppeteerInstance: browser,
        frame,
        output: null,
        imageFormat: "jpeg",
        jpegQuality: 80,
        scale: Math.max(0.1, Math.min(1, options.scale ?? 0.5)),
        cancelSignal,
        timeoutInMilliseconds: 60000,
      });
      if (buffer) out.push({ frame, jpeg: buffer });
    }
    return out;
  } finally {
    signal.removeEventListener("abort", stop);
    await browser.close({ silent: true }).catch(() => {});
  }
}
export async function exportMedia(options: {
  project: Project;
  timeline: Timeline;
  codec: string;
  crf: number;
  transparent: boolean;
  root: string;
  output: string;
  baseUrl: string;
  mediaToken?: string;
  hardware?: boolean;
  concurrency?: number;
  /** First frame and the frame after the last; omitted for the whole timeline. */
  range?: [number, number];
  signal: AbortSignal;
  progress(value: number, label?: string): void;
}) {
  const { project, timeline, codec, transparent, signal, progress } = options;
  signal.throwIfAborted();
  const plan = renderPlan(project, timeline, codec, transparent);
  const length = Math.max(1, durationInFrames(timeline)),
    range = options.range
      ? ([
          Math.max(0, Math.min(length - 1, Math.floor(options.range[0]))),
          Math.max(1, Math.min(length, Math.ceil(options.range[1]))),
        ] as const)
      : null;
  if (range && range[1] <= range[0]) throw new Error("导出范围为空");
  const serveUrl = path.join(options.root, "dist/render");
  if (!fs.existsSync(path.join(serveUrl, "index.html")))
    throw new Error("渲染资源缺失，请重新构建应用");
  const inputProps = renderProps(project, timeline, options, transparent);
  const browserExecutable = findBrowser() ?? undefined;
  progress(2, "准备渲染环境");
  const { cancel, cancelSignal } = makeCancelSignal();
  const browser = await openBrowser("chrome", {
    browserExecutable,
    // ANGLE uses the Mac's GPU for WebGL effects instead of a software renderer.
    ...(process.platform === "darwin"
      ? { chromiumOptions: { gl: "angle" as const } }
      : {}),
  });
  const stop = () => {
    cancel();
    void browser.close({ silent: true }).catch(() => {});
  };
  signal.addEventListener("abort", stop, { once: true });
  const requested = Math.max(
      1,
      Math.min(8, Math.round(options.concurrency ?? 2)),
    ),
    threads = renderConcurrency(requested, timeline.width, timeline.height, {
      free: os.freemem(),
      total: os.totalmem(),
    });
  if (threads < requested)
    progress(2, `内存有限，并行渲染由 ${requested} 降为 ${threads}`);
  const filename = `TadaCut-${project.revision}${range ? `-${range[0]}-${range[1]}` : ""}.${plan.extension}`;
  try {
    signal.throwIfAborted();
    const composition = await selectComposition({
      serveUrl,
      id: "TadaCut",
      inputProps,
      browserExecutable,
      puppeteerInstance: browser,
      timeoutInMilliseconds: 120000,
    });
    signal.throwIfAborted();
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      browserExecutable,
      puppeteerInstance: browser,
      codec: codec as Codec,
      outputLocation: path.join(options.output, filename),
      // Remotion frame ranges include their last frame.
      ...(range
        ? { frameRange: [range[0], range[1] - 1] as [number, number] }
        : {}),
      cancelSignal,
      concurrency: threads,
      hardwareAcceleration:
        options.hardware && ["h264", "h265"].includes(codec)
          ? "if-possible"
          : "disable",
      timeoutInMilliseconds: 120000,
      ...(["h264", "h265", "vp8", "vp9"].includes(codec)
        ? {
            crf: Math.max(
              0,
              Math.min(codec.startsWith("vp") ? 63 : 51, options.crf),
            ),
          }
        : {}),
      ...(transparent
        ? {
            pixelFormat:
              codec === "prores"
                ? ("yuva444p10le" as const)
                : ("yuva420p" as const),
            proResProfile: codec === "prores" ? ("4444" as const) : undefined,
            imageFormat: "png" as const,
          }
        : {}),
      onProgress: ({ progress: value }) => progress(5 + value * 94, "正在导出"),
    });
    signal.throwIfAborted();
    return { filename };
  } finally {
    signal.removeEventListener("abort", stop);
    await browser.close({ silent: true }).catch(() => {});
  }
}
