import { registerTeamRoutes } from "./team-client";
import { registerAdvancedRoutes } from "./advanced-routes";
import { registerMediaProcessing } from "./media-processing";
import { capcutEntry } from "./capcut";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { DomainError, cosineSimilarity } from "@tadacut/domain";
import { listModels, embedTexts, providerSchema } from "@tadacut/providers";
import {
  Repository,
  Vault,
  type Cipher,
  type Job,
  type Message,
  type Proposal,
  type Skill,
} from "./storage";
import { EventBus } from "./events";
import { JobQueue, publicJob } from "./jobs";
import { MediaService, mediaBinary } from "./media";
import { Artifacts } from "./artifacts";
import { AgentService } from "./agent";
import { registerHandlers } from "./handlers";
import { mountMcp } from "./mcp";
import { registerRoutes } from "./routes";
import { FolderWatchService } from "./watchers";
import { seed } from "./seed";
import { executable, runProcess } from "./process";
import { copilotInstalled } from "./external";
import {
  installFromGitHub,
  skillFromMarkdown,
  skillToMarkdown,
} from "./skills";
import type { DesktopPort } from "../../../packages/platform/src/contract";
import { studioResultSchema } from "../../../packages/platform/src/studio";
import { StudioControl } from "./studio-control";
import { checkRuntime, runtimeStatuses, runtimeIds } from "./runtime-status";

export interface ServerOptions {
  root: string;
  dataDir: string;
  port?: number;
  desktop?: DesktopPort;
  cipher?: Cipher;
  seed?: boolean;
  allowedDirectories?: () => string[];
  /** Extra page origins allowed to call the API, such as the Vite dev server. Empty in packaged builds. */
  devOrigins?: string[];
}
export async function createStudioServer(options: ServerOptions) {
  const app = Fastify({
    logger: false,
    bodyLimit: 16 * 1024 * 1024,
    // A paused media stream would otherwise hold the server (and app quit) open.
    forceCloseConnections: true,
  });
  const vault = new Vault(options.dataDir, options.cipher),
    repo = new Repository(options.dataDir, vault);
  const events = new EventBus(),
    jobs = new JobQueue(repo, events.publish);
  const studioControl = new StudioControl(events.publish);
  const mediaDir = path.join(options.dataDir, "media"),
    artifactsDir = path.join(options.dataDir, "artifacts");
  const media = new MediaService(repo, mediaDir, events.publish),
    artifacts = new Artifacts(repo, media, artifactsDir);
  if (options.seed !== false) seed(repo, mediaDir);
  // Created once without opening anything; read on first use, since opening it
  // may ask the system keychain and should not block startup.
  if (!vault.has("mcp"))
    vault.set("mcp", crypto.randomBytes(32).toString("base64url"));
  const mcpToken = () => {
    let token = vault.get("mcp");
    if (!token) {
      token = crypto.randomBytes(32).toString("base64url");
      vault.set("mcp", token);
    }
    return token;
  };
  const sessionToken = crypto.randomBytes(32).toString("base64url"),
    mediaToken = crypto.randomBytes(32).toString("base64url");
  repo.saveSettings("media-token", mediaToken);
  const watches = new FolderWatchService(
    repo,
    media,
    options.allowedDirectories ?? (() => []),
    events.publish,
  );
  await watches.restore();
  const agent = new AgentService(
    repo,
    jobs,
    events.publish,
    options.desktop,
    media,
    artifacts,
    options.root,
    artifactsDir,
    options.allowedDirectories ?? (() => []),
    {
      control: studioControl.request,
      async request(method, url, body) {
        const response = await app.inject({
          method,
          url,
          headers: {
            host: "127.0.0.1",
            cookie: `${cookieName()}=${sessionToken}`,
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
        });
        const value = String(response.headers["content-type"]).includes(
          "application/json",
        )
          ? response.json()
          : response.body;
        if (response.statusCode >= 400)
          throw new Error(
            value?.message ?? `应用操作失败（${response.statusCode}）`,
          );
        return value;
      },
    },
  );
  registerHandlers({
    repo,
    jobs,
    media,
    agent,
    publish: events.publish,
    desktop: options.desktop,
    root: options.root,
    artifactsDir,
    artifacts,
  });
  registerMediaProcessing({ repo, jobs, media, agent, root: options.root });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { files: 1, fileSize: 512 * 1024 * 1024 },
  });
  let address = `http://127.0.0.1:${options.port ?? 4317}`;
  const cookieName = () => "tadacut-session-" + new URL(address).port;
  // Cookies are shared across ports on 127.0.0.1, so only the studio's own
  // origin (and an explicitly configured dev server) may use the session.
  const devOrigins = new Set(options.devOrigins ?? []);
  const isTrusted = (origin?: string) =>
    !origin || origin === address || devOrigins.has(origin);
  app.addHook("onRequest", async (request, reply) => {
    const hostname = (request.headers.host ?? "").split(":")[0];
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname))
      return reply.code(403).send({ message: "仅接受本机连接" });
    const raw = request.url.split("?")[0];
    const decoded = decodeURIComponent(raw);
    const url = path.posix.normalize(decoded);
    if (raw !== decoded || decoded !== url || decoded.includes("\\"))
      return reply.code(400).send({ message: "请求路径格式错误" });
    if (url === "/mcp") {
      if (
        request.headers.authorization !== `Bearer ${mcpToken()}` ||
        !isTrusted(request.headers.origin)
      )
        return reply.code(401).send({ message: "MCP 凭据无效" });
      return;
    }
    if (
      url.startsWith("/api/") ||
      url.startsWith("/media/") ||
      url.startsWith("/artifacts/")
    ) {
      const tokenAccess =
        url.startsWith("/media/") &&
        (request.query as any)?.access === mediaToken;
      if (
        !tokenAccess &&
        (!isTrusted(request.headers.origin) ||
          request.headers["sec-fetch-site"] === "cross-site")
      )
        return reply.code(403).send({ message: "请求来源不受信任" });
      if (url === "/api/session") {
        reply.setCookie(cookieName(), sessionToken, {
          path: "/",
          httpOnly: true,
          sameSite: "strict",
        });
        return;
      }
      if (!tokenAccess && request.cookies[cookieName()] !== sessionToken)
        return reply.code(401).send({ message: "请重新打开工作台" });
      if (tokenAccess) reply.header("Access-Control-Allow-Origin", "*");
    }
  });
  app.addHook("onSend", async (request, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer");
    if (request.url.startsWith("/api/"))
      reply.header("Cache-Control", "no-store");
    if (request.url.startsWith("/motion-frame.html"))
      reply.header(
        "Content-Security-Policy",
        "default-src 'none'; script-src http://127.0.0.1:* http://localhost:* 'unsafe-eval'; style-src 'unsafe-inline'; img-src http://127.0.0.1:* http://localhost:* data: blob:; media-src http://127.0.0.1:* http://localhost:* blob:; connect-src 'none'; frame-ancestors http://127.0.0.1:* http://localhost:*",
      );
    else if (
      !request.url.startsWith("/media/") &&
      !request.url.startsWith("/artifacts/")
    )
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' data: blob: https://huggingface.co https://cdn-lfs.huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      );
  });
  app.setErrorHandler((error, _request, reply) => {
    const status =
      error instanceof DomainError
        ? error.code === "REVISION_CONFLICT" || error.code === "SYNC_CONFLICT"
          ? 409
          : 400
        : error instanceof z.ZodError
          ? 400
          : ((error as any).statusCode ?? 400);
    reply.code(status).send({
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof DomainError
        ? { code: error.code, detail: error.detail }
        : {}),
    });
  });
  const id = (request: any) => String(request.params.id);
  app.get("/api/session", async () => ({ ready: true }));
  app.get("/api/health", async () => ({ ready: true, version: "0.1.0" }));
  app.get("/api/agent/runtimes", async () => runtimeStatuses());
  app.post("/api/agent/runtimes/:id/check", async (request) =>
    checkRuntime(z.enum(runtimeIds).parse(id(request))),
  );
  app.post("/api/studio/actions/:id/result", async (request) => {
    const { projectId, clientId, ...result } = studioResultSchema
      .extend({ projectId: z.string(), clientId: z.string().uuid().optional() })
      .parse(request.body);
    return {
      accepted: studioControl.acknowledge(
        id(request),
        projectId,
        result,
        clientId,
      ),
    };
  });
  app.get("/api/projects", async () => repo.projects());
  app.post("/api/projects", async (request) => {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(120) })
      .parse(request.body);
    const p = repo.create(name);
    events.publish("project", p);
    return p;
  });
  app.get("/api/projects/:id", async (request) => repo.get(id(request)));
  app.post("/api/projects/:id/commands", async (request) => {
    const r = repo.commit(id(request), request.body as any);
    events.publish("project", r.project);
    return r;
  });
  for (const direction of ["undo", "redo"] as const)
    app.post(`/api/projects/:id/${direction}`, async (request) => {
      const { expectedRevision } = z
        .object({ expectedRevision: z.number().int().nonnegative() })
        .parse(request.body);
      const p = repo.travel(id(request), expectedRevision, direction);
      events.publish("project", p);
      return p;
    });
  app.get("/api/projects/:id/history", async (request) =>
    repo.history(id(request)),
  );
  app.post("/api/projects/:id/assets", async (request) => {
    repo.get(id(request));
    const upload = await request.file();
    if (!upload) throw new Error("请选择素材文件");
    const file = path.join(
      mediaDir,
      crypto.randomUUID() + media.extension(upload.filename),
    );
    await fsp.writeFile(file, await upload.toBuffer(), { flag: "wx" });
    try {
      return await media.register(
        id(request),
        file,
        path.basename(upload.filename),
        upload.mimetype,
      );
    } catch (e) {
      await fsp.unlink(file).catch(() => {});
      throw e;
    }
  });
  app.get("/api/projects/:id/assets/:assetId/audio", async (request, reply) => {
    const asset = repo
      .get(id(request))
      .assets.find((a) => a.id === (request.params as any).assetId);
    if (!asset) throw new Error("素材不存在");
    const rate = Math.max(
        8000,
        Math.min(48000, Number((request.query as any).rate) || 16000),
      ),
      seconds = Math.max(
        1,
        Math.min(1200, Number((request.query as any).seconds) || 1200),
      ),
      ffmpeg = mediaBinary("ffmpeg");
    if (!ffmpeg) throw new Error("音频提取需要 FFmpeg");
    const output = await runProcess(
      ffmpeg,
      [
        "-v",
        "error",
        "-i",
        media.file(asset),
        "-vn",
        "-t",
        String(seconds),
        "-ac",
        "1",
        "-ar",
        String(rate),
        "-f",
        "f32le",
        "pipe:1",
      ],
      AbortSignal.timeout(120000),
      256 * 1024 * 1024,
    );
    return reply.type("application/octet-stream").send(output.stdout);
  });
  app.post("/api/projects/:id/assets/:assetId/relink", async (request) => {
    const p = repo.get(id(request)),
      assetId = String((request.params as any).assetId);
    if (!p.assets.some((a) => a.id === assetId)) throw new Error("素材不存在");
    const upload = await request.file();
    if (!upload) throw new Error("请选择重连文件");
    const file = path.join(
      mediaDir,
      crypto.randomUUID() + media.extension(upload.filename),
    );
    await fsp.writeFile(file, await upload.toBuffer());
    return media.register(
      p.id,
      file,
      path.basename(upload.filename),
      upload.mimetype,
      {
        id: assetId,
        tags: p.assets
          .find((a) => a.id === assetId)!
          .tags.filter((t) => t !== "待重连"),
      },
    );
  });
  app.post("/api/projects/import", async (request) => {
    const upload = await request.file();
    if (!upload) throw new Error("请选择工程文件");
    const p = await artifacts.import(await upload.toBuffer(), upload.filename);
    events.publish("project", p);
    return p;
  });
  app.post("/api/projects/:id/artifact", async (request) => {
    const body = z
      .object({
        format: z.enum([
          "project",
          "fcpxml",
          "srt",
          "markdown",
          "capcut",
          "edl",
        ]),
        timelineId: z.string().optional(),
      })
      .parse(request.body);
    return artifacts.export(id(request), body.format, body.timelineId);
  });
  app.get("/api/projects/:id/messages", async (request) =>
    repo
      .list<Message>("message")
      .filter((m) => m.projectId === id(request))
      .reverse(),
  );
  app.get("/api/projects/:id/proposals", async (request) =>
    repo.list<Proposal>("proposal").filter((m) => m.projectId === id(request)),
  );
  app.post("/api/proposals/:id", async (request) =>
    agent.respond(
      id(request),
      z.object({ apply: z.boolean() }).parse(request.body).apply,
    ),
  );
  app.get("/api/providers", async () => repo.providers());
  app.post("/api/providers", async (request) => {
    const input = z
      .object({
        provider: providerSchema,
        apiKey: z.string().max(8192).optional(),
      })
      .parse(request.body);
    const result = repo.saveProvider(input.provider, input.apiKey);
    events.publish("providers", repo.providers());
    return result;
  });
  app.delete("/api/providers/:id", async (request) => {
    repo.deleteProvider(id(request));
    events.publish("providers", repo.providers());
    return { deleted: true };
  });
  app.post("/api/providers/test", async (request) => {
    const input = z
      .object({ provider: providerSchema, apiKey: z.string().optional() })
      .parse(request.body);
    return listModels({
      provider: input.provider,
      apiKey: input.apiKey ?? repo.providerKey(input.provider.id),
      signal: AbortSignal.timeout(15000),
    });
  });
  app.post("/api/providers/:id/models", async (request) =>
    listModels(agent.context(id(request), AbortSignal.timeout(15000))),
  );
  app.post("/api/projects/:id/search", async (request) => {
    const { query, providerId } = z
      .object({ query: z.string().min(1), providerId: z.string().optional() })
      .parse(request.body);
    const assets = repo.get(id(request)).assets;
    if (!providerId)
      return assets
        .filter((a) =>
          (a.name + a.description + a.tags.join(" "))
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .map((asset) => ({ asset, score: 1 }));
    const [vector] = await embedTexts(
      agent.context(providerId, AbortSignal.timeout(30000)),
      [query],
    );
    return assets
      .filter((a) => a.embedding?.length === vector.length)
      .map((asset) => ({
        asset,
        score: cosineSimilarity(asset.embedding!, vector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);
  });
  app.get("/api/projects/:id/watches", async (request) =>
    watches.list(id(request)),
  );
  app.post("/api/projects/:id/watches", async (request) =>
    watches.add(
      id(request),
      z.object({ directory: z.string() }).parse(request.body).directory,
    ),
  );
  app.delete("/api/watches/:id", async (request) => {
    watches.remove(id(request));
    return { removed: true };
  });
  app.get("/api/jobs", async () => repo.list<Job>("job").map(publicJob));
  app.post("/api/jobs", async (request) => {
    const { projectId, kind, label, input } = z
      .object({
        projectId: z.string(),
        kind: z.string(),
        label: z.string().max(160),
        input: z.record(z.unknown()).default({}),
      })
      .parse(request.body);
    return publicJob(jobs.enqueue(projectId, kind, label, input));
  });
  app.post("/api/jobs/:id/cancel", async (request) => jobs.cancel(id(request)));
  const skillSchema = z
    .object({
      id: z.string().min(1),
      name: z.string().min(1).max(100),
      category: z.string().max(100),
      description: z.string().max(1000),
      prompt: z.string().max(100000),
      tools: z.array(z.string()),
      enabled: z.boolean(),
      builtin: z.boolean().optional(),
      script: z.string().max(100000).optional(),
      files: z
        .array(
          z.object({
            path: z.string().max(300),
            content: z.string().max(200000),
          }),
        )
        .max(40)
        .optional(),
      context: z.enum(["inline", "fork"]).optional(),
      command: z
        .string()
        .regex(/^[\p{L}\p{N}_-]{1,40}$/u, "命令只能包含文字、数字、- 和 _")
        .optional(),
      source: z.string().max(2000).optional(),
    })
    .strict();
  app.get("/api/skills", async () => repo.list<Skill>("skill"));
  const changedSkills = (skill: Skill) => {
    events.publish("skills", repo.list<Skill>("skill"));
    return skill;
  };
  app.post("/api/skills", async (request) =>
    changedSkills(repo.save("skill", skillSchema.parse(request.body))),
  );
  app.post("/api/skills/install", async (request) => {
    const { url } = z.object({ url: z.string().url() }).parse(request.body);
    return changedSkills(
      repo.save<Skill>(
        "skill",
        await installFromGitHub(url, AbortSignal.timeout(30000)),
      ),
    );
  });
  app.post("/api/skills/import", async (request) => {
    const { markdown } = z
      .object({ markdown: z.string().min(1).max(100000) })
      .parse(request.body);
    return changedSkills(
      repo.save<Skill>("skill", skillFromMarkdown(markdown)),
    );
  });
  app.delete("/api/skills/:id", async (request) => {
    const skill = repo.record<Skill>("skill", id(request));
    if (skill?.builtin) throw new Error("内置技能可以停用，不能删除");
    repo.deleteRecord("skill", id(request));
    events.publish("skills", repo.list<Skill>("skill"));
    return { deleted: true };
  });
  app.get("/api/skills/:id/export", async (request, reply) => {
    const skill = repo.record<Skill>("skill", id(request));
    if (!skill) throw new Error("技能不存在");
    return reply
      .header("Content-Type", "text/markdown; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="SKILL.md"')
      .send(skillToMarkdown(skill));
  });
  app.get("/api/settings", async () =>
    repo.settings("preferences", { name: "我的创作空间" }),
  );
  app.post("/api/settings", async (request) => {
    const settings = repo.saveSettings(
      "preferences",
      z.object({ name: z.string().max(120) }).parse(request.body),
    );
    events.publish("settings", settings);
    return settings;
  });
  app.get("/api/capabilities", async () => ({
    platform: process.platform,
    desktop: Boolean(options.desktop),
    ffmpeg: Boolean(mediaBinary("ffmpeg")),
    ffprobe: Boolean(mediaBinary("ffprobe")),
    dataDir: options.dataDir,
    agents: {
      codex: Boolean(executable("codex")),
      claude: Boolean(executable("claude")),
      copilot: copilotInstalled(),
    },
    capcut: Boolean(capcutEntry()),
    deno: Boolean(executable("deno")),
  }));
  app.get("/api/mcp-config", async () => ({
    mcpServers: {
      tadacut: {
        type: "http",
        url: address + "/mcp",
        headers: { Authorization: `Bearer ${mcpToken()}` },
      },
    },
  }));
  app.get("/api/events", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    events.subscribe(reply.raw, Number(request.headers["last-event-id"] ?? 0));
  });
  registerRoutes(app, {
    repo,
    agent,
    jobs,
    media,
    publish: events.publish,
    dataDir: options.dataDir,
    root: options.root,
  });
  registerAdvancedRoutes(app, { repo, jobs, publish: events.publish });
  registerTeamRoutes(app, {
    repo,
    media,
    dataDir: options.dataDir,
    artifactsDir,
    publish: events.publish,
  });
  mountMcp(app, repo, agent);
  await app.register(staticFiles, {
    root: mediaDir,
    prefix: "/media/",
    decorateReply: true,
    index: false,
  });
  await app.register(staticFiles, {
    root: artifactsDir,
    prefix: "/artifacts/",
    decorateReply: false,
    index: false,
  });
  const studio = path.join(options.root, "apps/studio/dist");
  if (fs.existsSync(studio)) {
    await app.register(staticFiles, {
      root: studio,
      prefix: "/",
      decorateReply: false,
    });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith("/api/")
        ? reply.code(404).send({ message: "接口不存在" })
        : reply.sendFile("index.html", studio),
    );
  }
  // Event streams never finish on their own, and onClose only runs once every
  // request has, so they are ended before the server waits for requests.
  app.addHook("preClose", async () => {
    studioControl.close();
    events.close();
  });
  app.addHook("onClose", async () => {
    await watches.close();
    await jobs.stop();
    repo.close();
  });
  return {
    app,
    repo,
    jobs,
    media,
    artifacts,
    agent,
    events,
    studioControl,
    async listen() {
      address = await app.listen({
        port: options.port ?? 4317,
        host: "127.0.0.1",
      });
      repo.saveSettings("server-url", address);
      return address;
    },
    close: () => app.close(),
  };
}
