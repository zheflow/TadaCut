import { understandMedia } from "./understand";
import { executeSkillScript } from "./skill-script";
import { assertPublicUrl } from "./public-web";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright-core";
import {
  alignAudio,
  activeTimeline,
  assetSchema,
  clipSchema,
  parseTimecode,
  type Command,
} from "@tadacut/domain";
import {
  cloneVoice,
  completeChat,
  embedTexts,
  generateImage,
  generateTask,
  synthesizeSpeech,
  transcribe,
} from "@tadacut/providers";
import { type JobQueue } from "./jobs";
import { type Repository } from "./storage";
import { type MediaService } from "./media";
import { AgentService } from "./agent";
import { findBrowser } from "./process";
import type { DesktopPort } from "../../../packages/platform/src/contract";
import { exportMedia } from "../../../packages/render/src/exporter";
import type { Artifacts } from "./artifacts";
import { analysisRecord } from "./analysis-cache";
import {
  generateMore,
  imageSize,
  registerExtendedJobs,
  saveExport,
  timelineEnd,
} from "./jobs-extended";
export function registerHandlers({
  repo,
  jobs,
  media,
  agent,
  publish,
  desktop,
  root,
  artifactsDir,
}: {
  repo: Repository;
  jobs: JobQueue;
  media: MediaService;
  agent: AgentService;
  publish(type: string, data: unknown): void;
  desktop?: DesktopPort;
  root: string;
  artifactsDir: string;
  artifacts?: Artifacts;
}) {
  registerExtendedJobs({
    repo,
    jobs,
    media,
    agent,
    publish,
    root,
    artifactsDir,
  });
  jobs.register("skill-script", async ({ job, signal }) => {
    const skill = repo.record<any>("skill", job.input.skillId);
    if (!skill) throw new Error("技能不存在");
    const p = repo.get(job.projectId),
      result = await executeSkillScript(
        skill,
        p,
        media,
        job.input.input ?? {},
        signal,
      );
    if (result.commands?.length)
      return {
        summary: result.summary,
        proposalId: agent.proposal(
          p.id,
          result.label ?? skill.name,
          result.commands,
          p.revision,
        ).id,
      };
    return result;
  });
  jobs.register("motion-ai", async ({ job, signal, progress }) => {
    progress(10, "生成 React 代码动画");
    let code = "";
    await completeChat(
      agent.context(job.input.providerId, signal),
      "只输出一个独立 React default export 函数组件。props 是 frame、fps、width、height。仅使用 React 和内联样式；不使用网络、外部库或宿主 API。背景保持透明。",
      [{ role: "user", content: job.input.prompt }],
      [],
      (delta) => {
        code += delta;
      },
    );
    code = code
      .trim()
      .replace(/^```(?:tsx|jsx|typescript|javascript)?\s*/, "")
      .replace(/\s*```$/, "");
    if (!code.includes("export default"))
      throw new Error("模型没有返回 default export 组件，请重试");
    const asset = assetSchema.parse({
      id: crypto.randomUUID(),
      name: "AI 代码动画",
      kind: "motion",
      code,
      url: "",
      duration: 5,
      createdAt: new Date().toISOString(),
      tags: ["代码动画", "AI 生成"],
    });
    const current = repo.get(job.projectId);
    const next = repo.commit(current.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: current.revision,
      label: "保存 AI 动画",
      commands: [{ type: "asset.add", asset }],
    }).project;
    publish("project", next);
    return { assetId: asset.id, message: "可在素材库中编辑和预览动画代码" };
  });
  jobs.register("agent", (ctx) => agent.run(ctx));
  jobs.register("generate", async ({ job, signal, progress }) => {
    const { capability, providerId, prompt } = job.input;
    if (!providerId || !prompt) throw new Error("请选择模型服务并填写内容");
    const ctx = agent.context(providerId, signal);
    if (!ctx.provider.capabilities.includes(capability))
      throw new Error("此供应商未启用该能力");
    progress(5, "连接所选模型服务");
    if (capability === "voice-clone") {
      const asset = repo
        .get(job.projectId)
        .assets.find((a) => a.id === job.input.assetId);
      if (!asset) throw new Error("请选择参考音频");
      progress(15, "准备参考音频");
      return cloneVoice(ctx, prompt, [
        await media.audioUpload(asset, signal, 44100),
      ]);
    }
    const before = repo.get(job.projectId),
      shot = before.story.shots.find((s) => s.id === job.input.shotId),
      fingerprint = shot
        ? JSON.stringify([
            shot.description,
            shot.prompt,
            shot.assetId,
            shot.duration,
          ])
        : null;
    const entities = before.story.entities.filter((e) =>
      shot?.entityIds.includes(e.id),
    );
    const references: Uint8Array[] = [];
    if (capability === "image") {
      const { default: sharp } = await import("sharp");
      for (const id of [
        ...new Set(
          entities
            .filter((e) => e.confirmed)
            .flatMap((e) => e.referenceAssetIds),
        ),
      ].slice(0, 4)) {
        const reference = before.assets.find(
          (a) => a.id === id && a.kind === "image",
        );
        if (reference)
          references.push(
            await sharp(media.file(reference))
              .resize({ width: 1024, withoutEnlargement: true })
              .jpeg()
              .toBuffer(),
          );
      }
    }
    const enhanced =
      String(prompt) +
      (entities.length
        ? "\n保持以下人物、场景与道具设定：\n" +
          entities.map((e) => `${e.name}: ${e.description}`).join("\n")
        : "");
    const generated =
      (await generateMore(media, ctx, before, job.input, signal, (v) =>
        progress(5 + v * 0.8),
      )) ??
      (capability === "image"
        ? await generateImage(
            ctx,
            enhanced,
            String(job.input.size ?? imageSize(activeTimeline(before))),
            references,
          )
        : capability === "speech"
          ? await synthesizeSpeech(ctx, prompt, job.input.voice || "alloy")
          : capability === "video" || capability === "music"
            ? await generateTask(
                ctx,
                capability,
                prompt,
                Number(job.input.duration ?? 8),
                progress,
              )
            : null);
    if (!generated) throw new Error("不支持的生成能力");
    progress(90, "下载并注册生成素材");
    const result = await media.generated(
      job.projectId,
      capability === "speech"
        ? "AI 配音"
        : capability === "music"
          ? "AI 配乐"
          : capability === "sfx"
            ? "AI 音效"
            : (shot?.title ?? "AI 生成素材"),
      generated,
      signal,
      {
        provider: ctx.provider.name,
        description: String(prompt),
        tags: ["AI 生成", ...(capability === "sfx" ? ["音效"] : [])],
        source: { kind: "generated", name: ctx.provider.name },
      },
    );
    if (shot && fingerprint) {
      const current = repo.get(job.projectId),
        target = current.story.shots.find((s) => s.id === shot.id);
      if (
        target &&
        JSON.stringify([
          target.description,
          target.prompt,
          target.assetId,
          target.duration,
        ]) === fingerprint
      ) {
        const p = repo.commit(current.id, {
          requestId: crypto.randomUUID(),
          expectedRevision: current.revision,
          label: "绑定生成分镜素材",
          commands: [
            {
              type: "story.shot.upsert",
              shot: { ...target, assetId: result.asset.id, status: "ready" },
            },
          ],
        }).project;
        publish("project", p);
      } else
        return {
          assetId: result.asset.id,
          bindingApplied: false,
          message: "素材已保存。分镜期间发生变化，请手动选择是否绑定。",
        };
    }
    return { assetId: result.asset.id, url: result.asset.url };
  });
  jobs.register("transcribe", async ({ job, signal, progress }) => {
    const p = repo.get(job.projectId),
      asset = p.assets.find((a) => a.id === job.input.assetId);
    if (!asset) throw new Error("请选择音视频素材");
    progress(5, "准备音频");
    const audio = await media.audioUpload(asset, signal);
    progress(10, "正在转写音频");
    const result = await transcribe(
      agent.context(job.input.providerId, signal),
      audio,
    );
    signal.throwIfAborted();
    const current = repo.get(p.id);
    const transcript = {
      id:
        current.transcripts.find((t) => t.assetId === asset.id)?.id ??
        crypto.randomUUID(),
      assetId: asset.id,
      language: result.language ?? "auto",
      words: result.words!.map((w, i) => ({
        id: `${asset.id}-word-${i}`,
        text: w.word,
        start: w.start,
        end: w.end,
        speaker: "说话人 1",
        deleted: false,
      })),
    };
    const next = repo.commit(p.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: current.revision,
      label: "语音转写",
      commands: [{ type: "transcript.set", transcript }],
    }).project;
    publish("project", next);
    return { transcriptId: transcript.id, words: transcript.words.length };
  });
  jobs.register("analyze", async ({ job, signal, progress }) => {
    const p = repo.get(job.projectId),
      asset = p.assets.find((a) => a.id === job.input.assetId);
    if (!asset) throw new Error("请选择音视频素材");
    progress(10, "本机分析声音");
    const result = await media.analyze(asset, signal);
    repo.save("analysis", analysisRecord(p.id, asset, result));
    const current = repo.get(p.id);
    const next = repo.commit(p.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: current.revision,
      label: "保存音频分析",
      commands: [
        {
          type: "asset.update",
          assetId: asset.id,
          patch: { waveform: result.waveform },
        },
      ],
    }).project;
    publish("project", next);
    return { ...result, envelopes: undefined };
  });
  jobs.register("voice-clean", async ({ job, signal, progress }) => {
    const asset = repo
      .get(job.projectId)
      .assets.find((a) => a.id === job.input.assetId);
    if (!asset) throw new Error("请选择音视频素材");
    progress(10, "本机人声降噪");
    const result = await media.voiceClean(job.projectId, asset, signal);
    return {
      assetId: result.asset.id,
      url: result.asset.url,
      message: "高低通与频谱降噪；请试听后使用，不是音乐人声分离模型",
    };
  });
  jobs.register("normalize", async ({ job, signal, progress }) => {
    const asset = repo
      .get(job.projectId)
      .assets.find((a) => a.id === job.input.assetId);
    if (!asset) throw new Error("请选择音视频素材");
    progress(15, "本机响度归一");
    const result = await media.normalize(
      job.projectId,
      asset,
      Number(job.input.targetLufs ?? -14),
      signal,
    );
    return { assetId: result.asset.id, url: result.asset.url };
  });
  jobs.register("silence", async ({ job, signal, progress }) => {
    const p = repo.get(job.projectId),
      asset = p.assets.find((a) => a.id === job.input.assetId);
    if (!asset) throw new Error("请选择音视频素材");
    progress(15, "分析静音区域");
    const result = await media.analyze(asset, signal);
    const t = activeTimeline(repo.get(p.id));
    const commands: Command[] = [];
    for (const track of t.tracks) {
      let removed = 0;
      for (const c of [...t.clips]
        .filter((c) => c.trackId === track.id)
        .sort((a, b) => a.start - b.start)) {
        if (c.assetId !== asset.id) {
          if (removed)
            commands.push({
              type: "clip.update",
              timelineId: t.id,
              clipId: c.id,
              patch: { start: Math.max(0, c.start - removed) },
            });
          continue;
        }
        const start = c.sourceOffset,
          end = start + (c.duration / t.fps) * c.speed,
          ranges: [number, number][] = [];
        let cursor = start;
        for (const r of result.silence) {
          const a = Math.max(start, r.start),
            b = Math.min(end, r.end);
          if (b <= a) continue;
          if (a > cursor) ranges.push([cursor, a]);
          cursor = Math.max(cursor, b);
        }
        if (cursor < end) ranges.push([cursor, end]);
        commands.push({
          type: "clip.remove",
          timelineId: t.id,
          clipId: c.id,
          ripple: false,
        });
        let target = c.start - removed;
        for (const [a, b] of ranges) {
          const duration = Math.max(1, Math.round(((b - a) / c.speed) * t.fps));
          commands.push({
            type: "clip.add",
            timelineId: t.id,
            clip: clipSchema.parse({
              ...c,
              id: crypto.randomUUID(),
              start: Math.max(0, target),
              duration,
              sourceOffset: a,
              keyframes: {},
            }),
          });
          target += duration;
        }
        removed += c.duration - (target - (c.start - removed));
      }
    }
    if (!commands.length)
      return { silence: result.silence, message: "没有找到可剪辑的静音片段" };
    const proposal = agent.proposal(p.id, "移除静音", commands);
    return { proposalId: proposal.id, silence: result.silence };
  });
  jobs.register("multicam", async ({ job, signal, progress }) => {
    const p = repo.get(job.projectId),
      a = p.assets.find((a) => a.id === job.input.assetId),
      b = p.assets.find((a) => a.id === job.input.secondAssetId);
    if (!a || !b) throw new Error("请选择两个机位素材");
    progress(10, "提取机位音频");
    const [aa, bb] = await Promise.all([
      media.analyze(a, signal),
      media.analyze(b, signal),
    ]);
    progress(70, "计算音频相关性");
    const alignment =
      job.input.syncMode === "timecode" && a.timecode && b.timecode
        ? {
            offsetSeconds:
              (parseTimecode(b.timecode, activeTimeline(p).fps) -
                parseTimecode(a.timecode, activeTimeline(p).fps)) /
              activeTimeline(p).fps,
            confidence: 1,
          }
        : alignAudio(aa.envelopes, bb.envelopes, aa.envelopeRate);
    if (alignment.confidence < 0.15)
      throw new Error("声音相似度过低，请使用时间码或手动偏移同步");
    const t = activeTimeline(repo.get(p.id)),
      reference = t.clips.find((c) => c.assetId === a.id),
      other = t.clips.find((c) => c.assetId === b.id);
    if (!reference || !other) throw new Error("请先把两个机位放入时间线");
    const groupId = crypto.randomUUID();
    const proposal = agent.proposal(p.id, "同步两个机位", [
      {
        type: "clip.update",
        timelineId: t.id,
        clipId: other.id,
        patch: {
          start: Math.max(
            0,
            reference.start + Math.round(alignment.offsetSeconds * t.fps),
          ),
        },
      },
      {
        type: "multicam.create",
        timelineId: t.id,
        group: {
          id: groupId,
          name: "机位同步组",
          cameraClipIds: [reference.id, other.id],
          switches: [],
          audioClipId: reference.id,
        },
      },
    ]);
    return { alignment, proposalId: proposal.id };
  });
  jobs.register("understand", async ({ job, signal, progress }) => {
    const p = repo.get(job.projectId),
      asset = p.assets.find((a) => a.id === job.input.assetId);
    if (!asset) throw new Error("请选择图片或视频");
    progress(10, "取样并理解画面");
    const result = await understandMedia(
      media,
      asset,
      agent.context(job.input.providerId, signal),
    );
    const current = repo.get(p.id),
      live = current.assets.find((a) => a.id === asset.id);
    if (!live) throw new Error("素材已删除");
    const next = repo.commit(p.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: current.revision,
      label: "保存素材理解",
      commands: [
        {
          type: "asset.update",
          assetId: asset.id,
          patch: {
            description: result.description,
            tags: [...new Set([...live.tags, ...result.tags])],
          },
        },
      ],
    }).project;
    publish("project", next);
    return { ...result, message: "描述与标签已保存到素材" };
  });
  jobs.register("semantic", async ({ job, signal, progress }) => {
    const p = repo.get(job.projectId),
      ctx = agent.context(job.input.providerId, signal);
    if (!ctx.provider.capabilities.includes("embedding"))
      throw new Error("请选择启用了语义搜索的供应商");
    const texts = p.assets.map(
      (a) => `${a.name}\n${a.description}\n${a.tags.join(" ")}`,
    );
    if (!texts.length) return { indexed: 0 };
    progress(20, "生成素材语义向量");
    const vectors = await embedTexts(ctx, texts);
    const current = repo.get(p.id);
    const commands = p.assets
      .filter((a) => current.assets.some((c) => c.id === a.id))
      .map((a) => ({
        type: "asset.update" as const,
        assetId: a.id,
        patch: { embedding: vectors[p.assets.findIndex((x) => x.id === a.id)] },
      }));
    const next = repo.commit(p.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: current.revision,
      label: "建立语义索引",
      commands,
    }).project;
    publish("project", next);
    return { indexed: commands.length };
  });
  jobs.register("web", async ({ job, signal, progress }) => {
    const url = await assertPublicUrl(String(job.input.prompt));
    const browserPath = findBrowser();
    if (!browserPath)
      throw new Error("请安装 Chrome，或配置 TADACUT_CHROME_PATH");
    progress(10, "打开参考网页");
    const browser = await chromium.launch({
      headless: true,
      executablePath: browserPath,
    });
    const stop = () => void browser.close();
    signal.addEventListener("abort", stop, { once: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      });
      await page.route("**/*", async (route) => {
        try {
          if (route.request().url().startsWith("http"))
            await assertPublicUrl(route.request().url());
          await route.continue();
        } catch {
          await route.abort();
        }
      });
      await page.goto(url.href, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      const title = await page.title(),
        description = (await page.locator("body").innerText()).slice(0, 8000),
        bytes = await page.screenshot({ type: "png" });
      const result = await media.generated(
        job.projectId,
        title || "网页参考",
        { bytes, mime: "image/png" },
        signal,
        { description, tags: ["网页参考", url.hostname] },
      );
      return {
        assetId: result.asset.id,
        url: result.asset.url,
        source: url.href,
      };
    } finally {
      signal.removeEventListener("abort", stop);
      await browser.close();
    }
  });
  jobs.register("export", async ({ job, signal, progress }) => {
    const p = job.input.snapshot ?? repo.get(job.projectId),
      t =
        p.timelines.find((t: any) => t.id === job.input.timelineId) ??
        activeTimeline(p);
    const output = path.join(artifactsDir, job.id);
    await fs.mkdir(output, { recursive: true });
    const result = await exportMedia({
      project: p,
      timeline: t,
      codec: job.input.codec || "h264",
      crf: Number(job.input.crf ?? 20),
      transparent: job.input.transparent === true,
      root,
      output,
      baseUrl: repo.settings("server-url", "http://127.0.0.1:4317"),
      mediaToken: repo.settings("media-token", ""),
      hardware: job.input.hardware === true,
      concurrency: Number(job.input.concurrency ?? 2),
      range:
        Array.isArray(job.input.range) &&
        job.input.range.length === 2 &&
        job.input.range.every(
          (n: unknown) => Number.isInteger(n) && (n as number) >= 0,
        )
          ? [job.input.range[0], job.input.range[1]]
          : undefined,
      signal,
      progress,
    });
    const range = Array.isArray(job.input.range)
        ? (job.input.range as number[])
        : undefined,
      end = timelineEnd(t),
      frames = range ? Math.max(0, Math.min(end, range[1]) - range[0]) : end,
      codec = String(job.input.codec || "h264");
    const record = saveExport(
      repo,
      {
        id: job.id,
        projectId: job.projectId,
        timelineId: t.id,
        kind: ["mp3", "wav", "aac"].includes(codec) ? "audio" : "video",
        filename: result.filename,
        url: `/artifacts/${job.id}/${result.filename}`,
        codec,
        expected: {
          duration: frames / t.fps,
          fps: t.fps,
          width: t.width,
          height: t.height,
          audio: t.clips.some(
            (c: any) =>
              p.assets.find((a: any) => a.id === c.assetId)?.kind === "audio" &&
              c.volume > 0,
          ),
        },
      },
      path.join(output, result.filename),
    );
    publish("exports", { projectId: job.projectId });
    return {
      exportId: record.id,
      url: record.url,
      filename: result.filename,
    };
  });
  jobs.register("computer-use", async ({ job, signal, progress }) => {
    if (!desktop) throw new Error("应用操作需要桌面版");
    const context = agent.context(job.input.providerId, signal);
    let done = false;
    let actions = 0;
    const tools = [
      {
        name: "desktop_screenshot",
        description: "读取已经授权的目标窗口截图。",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: async () => {
          const shot = await desktop.screenshot(job.input.sessionId);
          return { _image: shot.image, width: shot.width, height: shot.height };
        },
      },
      {
        name: "desktop_action",
        description:
          "在用户选定窗口执行鼠标、键盘或滚动。坐标是窗口内归一化的 0–1。",
        parameters: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["click", "type", "key", "scroll"] },
            x: { type: "number" },
            y: { type: "number" },
            text: { type: "string" },
            key: { type: "string" },
            direction: { type: "string" },
            amount: { type: "number" },
          },
          required: ["type"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          signal.throwIfAborted();
          if (actions++ >= 25) throw new Error("单次应用任务最多执行 25 步");
          await desktop.action(job.input.sessionId, args);
          progress(Math.min(90, actions * 3), "应用操作 · " + actions + " 步");
          return { executed: true };
        },
      },
      {
        name: "finish",
        description: "用户要求的步骤已经完成，停止操作。",
        parameters: {
          type: "object",
          properties: { summary: { type: "string" } },
          required: ["summary"],
          additionalProperties: false,
        },
        execute: async (args: any) => {
          done = true;
          return { _finish: true, summary: args.summary };
        },
      },
    ];
    const { runAgent } = await import("../../../packages/agent/src/runner");
    const result = await runAgent({
      context,
      system:
        "你是受约束的应用操作助手。只执行用户明确要求的步骤，只操作授权窗口。每次操作前先截图确认当前状态；不读取或发送账号凭据、不执行用户未要求的系统或文件操作。完成后调用 finish 并结束。",
      messages: [{ role: "user", content: job.input.prompt }],
      tools,
      onText: () => {},
      onTool: () => {},
      maxTurns: 15,
    });
    return { summary: result.text, actions, completed: done };
  });
}
