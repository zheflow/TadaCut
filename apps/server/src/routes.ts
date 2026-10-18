import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { activeTimeline, DomainError } from "@tadacut/domain";
import { renderFrames } from "../../../packages/render/src/exporter";
import { searchStock } from "@tadacut/providers";
import type { AgentService } from "./agent";
import { buildTools, groupLabels } from "./agent-tools";
import { audioAnalysis } from "./analysis-cache";
import type { ExportRecord } from "./agent-tools/export";
import { globalMemories, type GlobalMemory } from "./agent-tools/project";
import { localFonts } from "./fonts";
import type { JobQueue } from "./jobs";
import { publicJob } from "./jobs";
import { studioContextSchema } from "../../../packages/platform/src/studio";
import type { MediaService } from "./media";
import {
  installPlugin,
  installedPlugins,
  pluginItem,
  pluginSummary,
  uninstallPlugin,
  type InstalledPlugin,
} from "./plugins";
import { fetchPublic } from "./public-web";
import type { Message, Repository } from "./storage";

const permission = z.enum(["allow", "ask", "deny"]);
/** Routes for the agent, versions, trash, exports, extensions, fonts and online libraries. */
export function registerRoutes(
  app: FastifyInstance,
  ctx: {
    repo: Repository;
    agent: AgentService;
    jobs: JobQueue;
    media: MediaService;
    publish(type: string, data: unknown): void;
    dataDir: string;
    root: string;
  },
) {
  const { repo, agent, jobs, publish } = ctx;
  const id = (request: any) => String(request.params.id);
  // Agent conversation
  app.get("/api/projects/:id/agent", async (request) =>
    agent.threadSummary(agent.thread(id(request))),
  );
  app.post("/api/projects/:id/agent/approve", async (request) => {
    const body = z
      .object({
        callId: z.string(),
        approve: z.boolean(),
        studioContext: studioContextSchema.optional(),
      })
      .parse(request.body);
    return publicJob(
      agent.approve(id(request), body.callId, body.approve, body.studioContext),
    );
  });
  app.post("/api/projects/:id/agent/continue", async (request) => {
    const body = z
      .object({
        providerId: z.string().optional(),
        mode: z.enum(["manual", "auto", "ask"]).optional(),
        studioContext: studioContextSchema.optional(),
      })
      .parse(request.body ?? {});
    return publicJob(
      agent.continueRun(
        id(request),
        body.providerId,
        body.mode,
        body.studioContext,
      ),
    );
  });
  app.post("/api/projects/:id/agent/draft", async (request) => {
    const { action } = z
      .object({ action: z.enum(["finalize", "discard"]) })
      .parse(request.body);
    if (action === "discard") {
      agent.discardDraft(id(request));
      return { discarded: true };
    }
    const proposal = agent.finalizeDraft(id(request));
    return { proposalId: proposal?.id ?? null };
  });
  app.delete("/api/projects/:id/agent/thread", async (request) =>
    agent.resetThread(id(request)),
  );
  /** Clears the visible conversation; the model's context goes with the thread above. */
  app.delete("/api/projects/:id/messages", async (request) => {
    const projectId = id(request);
    repo.get(projectId);
    let removed = 0;
    for (const m of repo.list<Message>("message"))
      if (m.projectId === projectId) {
        repo.deleteRecord("message", m.id);
        removed++;
      }
    return { removed };
  });
  app.get("/api/agent/settings", async () => agent.settings());
  app.post("/api/agent/settings", async (request) =>
    agent.saveSettings(
      z
        .object({
          permissions: z
            .object({
              read: permission,
              edit: permission,
              job: permission,
              manage: permission,
              generate: permission,
              external: permission,
              publish: permission,
            })
            .partial()
            .optional(),
          learnPreferences: z.boolean().optional(),
          verify: z.boolean().optional(),
          defaultMode: z.enum(["manual", "auto", "ask"]).optional(),
        })
        .parse(request.body) as any,
    ),
  );
  app.get("/api/agent/tools", async () => {
    const first = repo.projects()[0];
    if (!first) return { groups: groupLabels, tools: [] };
    const host = agent.host(first.id, new AbortController().signal, "manual");
    return {
      groups: groupLabels,
      tools: buildTools(host, {
        depth: 0,
        spawn: async () => ({ summary: "", usage: null }),
      }).map((t) => ({
        name: t.name,
        group: t.group,
        effect: t.effect,
        description: t.description,
      })),
    };
  });
  // Memories that apply across projects, and ones the agent noticed
  app.get("/api/memories", async () => globalMemories({ repo }));
  app.post("/api/memories", async (request) => {
    const body = z
      .object({
        id: z.string().optional(),
        text: z.string().min(1).max(1000),
        tags: z.array(z.string().max(30)).max(10).default([]),
      })
      .parse(request.body);
    const memory = repo.save<GlobalMemory>("memory", {
      id: body.id ?? crypto.randomUUID(),
      text: body.text,
      tags: body.tags,
      source: "user",
      updatedAt: new Date().toISOString(),
    });
    publish("memories", globalMemories({ repo }));
    return memory;
  });
  app.delete("/api/memories/:id", async (request) => {
    repo.deleteRecord("memory", id(request));
    publish("memories", globalMemories({ repo }));
    return { deleted: true };
  });
  app.get("/api/memory-candidates", async () => agent.memoryCandidates());
  app.post("/api/memory-candidates/:id", async (request) =>
    agent.resolveCandidate(
      id(request),
      z.object({ keep: z.boolean() }).parse(request.body).keep,
    ),
  );
  // Versions, duplicates and the trash
  app.get("/api/projects/:id/versions", async (request) =>
    repo.versions(id(request)),
  );
  app.post("/api/projects/:id/versions", async (request) => {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(120) })
      .parse(request.body);
    const version = repo.saveVersion(id(request), name);
    publish("versions", { projectId: id(request) });
    return version;
  });
  app.post("/api/projects/:id/versions/:versionId/restore", async (request) => {
    const { expectedRevision } = z
      .object({ expectedRevision: z.number().int().nonnegative() })
      .parse(request.body);
    const p = repo.restoreVersion(
      id(request),
      String((request.params as any).versionId),
      expectedRevision,
    );
    publish("project", p);
    return p;
  });
  app.delete("/api/projects/:id/versions/:versionId", async (request) => {
    repo.deleteVersion(id(request), String((request.params as any).versionId));
    publish("versions", { projectId: id(request) });
    return { deleted: true };
  });
  app.post("/api/projects/:id/duplicate", async (request) => {
    const { name } = z
      .object({ name: z.string().trim().max(200).optional() })
      .parse(request.body ?? {});
    const copy = repo.duplicate(id(request), name);
    publish("project", copy);
    return copy;
  });
  app.post("/api/projects/:id/trash", async (request) => {
    const { trashed, expectedRevision } = z
      .object({
        trashed: z.boolean(),
        expectedRevision: z.number().int().nonnegative(),
      })
      .parse(request.body);
    const result = repo.commit(id(request), {
      requestId: crypto.randomUUID(),
      expectedRevision,
      label: trashed ? "移到回收站" : "从回收站恢复",
      commands: [{ type: "project.trash", trashed }],
    });
    publish("project", result.project);
    return result.project;
  });
  app.delete("/api/projects/:id", async (request) => {
    const p = repo.get(id(request));
    if (!p.trashedAt)
      throw new DomainError("NOT_IN_TRASH", "请先把项目移到回收站");
    repo.deleteProject(p.id);
    publish("project-deleted", { id: p.id });
    return { deleted: true };
  });
  // Export history, checks and publishing
  app.get("/api/projects/:id/exports", async (request) =>
    repo
      .list<ExportRecord>("export")
      .filter((r) => r.projectId === id(request)),
  );
  app.post("/api/exports/:id/verify", async (request) => {
    const record = repo.record<ExportRecord>("export", id(request));
    if (!record) throw new Error("导出记录不存在");
    return publicJob(
      jobs.enqueue(record.projectId, "verify-export", "导出校验", {
        exportId: record.id,
      }),
    );
  });
  app.post("/api/exports/:id/publish", async (request) => {
    const record = repo.record<ExportRecord>("export", id(request));
    if (!record) throw new Error("导出记录不存在");
    const body = z
      .object({
        providerId: z.string(),
        title: z.string().min(1).max(300),
        description: z.string().max(5000).optional(),
        platforms: z.array(z.string().max(40)).min(1).max(12),
      })
      .parse(request.body);
    // Sent from the publish dialog, which is the user's confirmation.
    return publicJob(
      jobs.enqueue(record.projectId, "publish", `发布「${body.title}」`, {
        ...body,
        exportId: record.id,
        confirmed: true,
      }),
    );
  });
  // Extension packs
  app.get("/api/plugins", async () =>
    installedPlugins(repo).map(pluginSummary),
  );
  app.post("/api/plugins/install", async (request) => {
    let raw: string;
    if (request.isMultipart()) {
      const upload = await request.file();
      if (!upload) throw new Error("请选择扩展包");
      raw = (await upload.toBuffer()).toString("utf8");
    } else {
      const { url } = z.object({ url: z.string().url() }).parse(request.body);
      raw = (
        await fetchPublic(url, AbortSignal.timeout(60000), 64 * 1024 * 1024)
      ).bytes.toString("utf8");
    }
    const installed = installPlugin(repo, ctx.dataDir, raw);
    publish("plugins", installedPlugins(repo).map(pluginSummary));
    return pluginSummary(installed);
  });
  app.delete("/api/plugins/:id", async (request) => {
    uninstallPlugin(repo, ctx.dataDir, id(request));
    publish("plugins", installedPlugins(repo).map(pluginSummary));
    return { removed: true };
  });
  app.get("/api/plugins/:id/sounds/:soundId", async (request, reply) => {
    const plugin = repo.record<InstalledPlugin>("plugin", id(request)),
      sound = plugin?.contents.sounds.find(
        (x) => x.id === (request.params as any).soundId,
      );
    if (!sound || !fs.existsSync(sound.file)) throw new Error("音效不存在");
    return reply.type(sound.mime).send(fs.createReadStream(sound.file));
  });
  /** One resource from a pack, for the studio library; sound data stays in its file. */
  app.get("/api/plugins/:id/items/:kind/:itemId", async (request) => {
    const { kind, itemId } = request.params as { kind: string; itemId: string };
    const kinds = [
      "templates",
      "luts",
      "transitions",
      "effects",
      "cameraMoves",
      "captionStyles",
      "sounds",
    ] as const;
    if (!kinds.includes(kind as (typeof kinds)[number]))
      throw new Error("未知的扩展资源类型");
    const item = pluginItem(
      repo,
      id(request),
      kind as (typeof kinds)[number],
      itemId,
    ) as Record<string, unknown>;
    const { file: _file, ...rest } = item;
    return rest;
  });
  /** Copies an extension sound into the project, so removing the pack keeps the media. */
  app.post("/api/projects/:id/plugin-sound", async (request) => {
    const body = z
      .object({ pluginId: z.string(), soundId: z.string() })
      .parse(request.body);
    const sound = pluginItem(repo, body.pluginId, "sounds", body.soundId);
    const target = path.join(
      ctx.media.dir,
      crypto.randomUUID() + path.extname(sound.file),
    );
    await fsp.copyFile(sound.file, target);
    return ctx.media.register(
      id(request),
      target,
      sound.name + path.extname(sound.file),
      sound.mime,
      {
        tags: ["音效", "扩展", ...sound.tags],
        folder: "音效",
        source: {
          kind: "plugin",
          name: body.pluginId,
          ...(sound.license ? { license: sound.license } : {}),
        },
      },
    );
  });
  app.get("/api/fonts", async () => localFonts());
  /** Beats, pauses and loudness of a sound, analysed locally once and then cached. */
  app.get(
    "/api/projects/:id/assets/:assetId/audio-analysis",
    async (request) => {
      const p = repo.get(id(request)),
        asset = p.assets.find((a) => a.id === (request.params as any).assetId);
      if (!asset) throw new DomainError("NOT_FOUND", "素材不存在");
      const {
        id: _id,
        projectId: _project,
        hash: _hash,
        ...analysis
      } = await audioAnalysis(
        repo,
        ctx.media,
        p.id,
        asset,
        AbortSignal.timeout(180000),
      );
      return analysis;
    },
  );
  /**
   * One timeline frame rendered like the export (effects, LUTs, captions),
   * for the color scopes and look comparisons. Renders are serialized, since
   * each one starts a headless browser.
   */
  let rendering = Promise.resolve();
  app.get("/api/projects/:id/frame", async (request, reply) => {
    const q = z
      .object({
        frame: z.coerce.number().int().min(0),
        timelineId: z.string().optional(),
        scale: z.coerce.number().min(0.1).max(1).default(0.4),
      })
      .parse(request.query);
    const p = repo.get(id(request)),
      t = p.timelines.find((x) => x.id === q.timelineId) ?? activeTimeline(p);
    const work = rendering.then(() =>
      renderFrames({
        project: p,
        timeline: t,
        frames: [q.frame],
        root: ctx.root,
        baseUrl: repo.settings("server-url", "http://127.0.0.1:4317"),
        mediaToken: repo.settings("media-token", ""),
        scale: q.scale,
        signal: AbortSignal.timeout(90000),
      }),
    );
    rendering = work.then(
      () => {},
      () => {},
    );
    const [shot] = await work;
    if (!shot) throw new Error("没有渲染出画面");
    return reply
      .type("image/jpeg")
      .header("Cache-Control", "no-store")
      .send(shot.jpeg);
  });
  // Online media libraries
  app.post("/api/stock/search", async (request) => {
    const body = z
      .object({
        providerId: z.string(),
        query: z.string().min(1).max(200),
        kind: z.enum(["image", "video", "audio"]),
        page: z.number().int().min(1).max(50).optional(),
        orientation: z.enum(["landscape", "portrait", "square"]).optional(),
      })
      .parse(request.body);
    return searchStock(
      agent.context(body.providerId, AbortSignal.timeout(30000)),
      body,
    );
  });
  app.post("/api/projects/:id/import-url", async (request) => {
    const body = z
      .object({
        url: z.string().url(),
        name: z.string().max(200).optional(),
        license: z.string().max(300).optional(),
        author: z.string().max(200).optional(),
        sourceUrl: z.string().max(2000).optional(),
        sourceName: z.string().max(200).optional(),
      })
      .parse(request.body);
    return publicJob(
      jobs.enqueue(
        id(request),
        "url-import",
        `导入「${body.name ?? "网络素材"}」`,
        body,
      ),
    );
  });
}
